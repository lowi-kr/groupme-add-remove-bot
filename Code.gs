/**
 * GroupMe Member Management Bot
 * Commands (typed in the group chat):
 *   !add John +15555555555   -> adds that phone number with nickname "John"
 *   !add John (555) 555-5555 -> same, different phone formatting
 *   !add John 555-555-5555   -> same
 *   !add John 5555555555     -> same
 *   !remove Jordan            -> removes the member whose name matches "Jordan"
 *   !list                     -> shows all group members by nickname
 *   !list 5                   -> shows only the first 5 members
 *
 * Phone numbers can be typed in any common US format: with/without country
 * code, with/without dashes, spaces, dots, or parentheses. Anything that
 * doesn't parse gets a help message back instead of failing silently.
 *
 * SETUP (one-time):
 * 1. Deploy this as a Web App (Deploy > New deployment > Web app)
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 2. Copy the web app URL.
 * 3. Create a GroupMe bot at https://dev.groupme.com/bots, set its
 *    Callback URL to that web app URL, and note the bot_id + group_id.
 * 4. Get your GroupMe ACCESS TOKEN (not the bot_id) from
 *    https://dev.groupme.com/ (top of the page once logged in).
 * 5. In the Apps Script editor: Project Settings (gear icon) > Script Properties > Add:
 *      GROUPME_ACCESS_TOKEN = <your access token>
 *      GROUPME_BOT_ID       = <your bot id>
 *      GROUPME_GROUP_ID     = <your group id>
 *    Never put these values directly in this file.
 *
 * Only current members of the group can run !add/!remove (checked against
 * the sender_id on the incoming message) — anyone else's command is ignored.
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Ignore messages the bot itself sends (avoid loops), and system messages.
    if (data.sender_type === 'bot' || data.system) {
      return ContentService.createTextOutput('ok');
    }

    var text = (data.text || '').trim();
    var senderId = data.sender_id;

    if (/^!add\s+/i.test(text)) {
      handleAdd(text, senderId);
    } else if (/^!remove\s+/i.test(text)) {
      handleRemove(text, senderId);
    } else if (/^!list(\s|$)/i.test(text)) {
      handleList(text, senderId);
    }
  } catch (err) {
    Logger.log('Error in doPost: ' + err);
  }
  return ContentService.createTextOutput('ok');
}

function getProps_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GROUPME_ACCESS_TOKEN');
  var botId = props.getProperty('GROUPME_BOT_ID');
  var groupId = props.getProperty('GROUPME_GROUP_ID');
  if (!token || !botId || !groupId) {
    throw new Error('Missing GROUPME_ACCESS_TOKEN / GROUPME_BOT_ID / GROUPME_GROUP_ID script properties.');
  }
  return { token: token, botId: botId, groupId: groupId };
}

function isCurrentMember_(userId, props) {
  var url = 'https://api.groupme.com/v3/groups/' + props.groupId + '?token=' + props.token;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(resp.getContentText());
  var members = (json.response && json.response.members) || [];
  return members.some(function (m) { return m.user_id === userId; });
}

var ADD_HELP = 'To add someone text: !add John +15555555555';

/**
 * Pulls a phone number out of free text, accepting any common US format:
 *   5555555555, 555-555-5555, 555.555.5555, (555) 555-5555,
 *   +15555555555, 1-555-555-5555, 555 555 5555, etc.
 * Returns { normalized: "+1XXXXXXXXXX", remainder: <text with the phone
 * portion removed> }, or null if no valid US phone number is found.
 */
function extractPhone_(text) {
  var candidate = text.match(/\+?[\d][\d\-.\s()]{6,}\d/);
  if (!candidate) return null;

  var digits = candidate[0].replace(/[^\d]/g, '');

  if (digits.length === 11 && digits.charAt(0) === '1') {
    digits = digits.substring(1);
  }
  if (digits.length !== 10) return null;

  return { normalized: '+1' + digits, remainder: text.replace(candidate[0], '').trim() };
}

function handleAdd(text, senderId) {
  var props = getProps_();

  if (!isCurrentMember_(senderId, props)) {
    postMessage_(props, 'Only current group members can add people.');
    return;
  }

  var body = text.replace(/^!add\s*/i, '').trim();
  if (!body) {
    postMessage_(props, ADD_HELP);
    return;
  }

  var phoneInfo = extractPhone_(body);
  if (!phoneInfo) {
    postMessage_(props, "Couldn't find a valid phone number in that. " + ADD_HELP);
    return;
  }

  var nickname = phoneInfo.remainder.trim();
  if (!nickname) {
    postMessage_(props, 'Missing a name for that number. ' + ADD_HELP);
    return;
  }

  var phone = phoneInfo.normalized;

  var url = 'https://api.groupme.com/v3/groups/' + props.groupId + '/members/add?token=' + props.token;
  var payload = {
    members: [
      { nickname: nickname, phone_number: phone }
    ]
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code === 202) {
    // Adding is async in GroupMe's API — poll the results endpoint.
    var resultsId = JSON.parse(resp.getContentText()).response.results_id;
    Utilities.sleep(1500);
    var resultsUrl = 'https://api.groupme.com/v3/groups/' + props.groupId +
      '/members/results/' + resultsId + '?token=' + props.token;
    var resultsResp = UrlFetchApp.fetch(resultsUrl, { muteHttpExceptions: true });
    if (resultsResp.getResponseCode() === 200) {
      var added = JSON.parse(resultsResp.getContentText()).response.members || [];
      if (added.length > 0) {
        postMessage_(props, 'Added ' + (added[0].nickname || phone) + ' to the group.');
      } else {
        postMessage_(props, 'Could not add ' + phone + ' — number may already be a member or invalid.');
      }
    } else {
      postMessage_(props, 'Add request sent for ' + phone + ', still processing.');
    }
  } else {
    postMessage_(props, 'Failed to add ' + phone + ' (error ' + code + ').');
  }
}

function handleRemove(text, senderId) {
  var props = getProps_();

  if (!isCurrentMember_(senderId, props)) {
    postMessage_(props, 'Only current group members can remove people.');
    return;
  }

  var name = text.replace(/^!remove\s*/i, '').trim().toLowerCase();
  if (!name) {
    postMessage_(props, 'To remove someone text: !remove John');
    return;
  }

  var url = 'https://api.groupme.com/v3/groups/' + props.groupId + '?token=' + props.token;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var members = JSON.parse(resp.getContentText()).response.members || [];

  var target = members.find(function (m) {
    return m.nickname && m.nickname.toLowerCase().indexOf(name) !== -1;
  });

  if (!target) {
    postMessage_(props, 'No member found matching "' + name + '".');
    return;
  }

  var removeUrl = 'https://api.groupme.com/v3/groups/' + props.groupId +
    '/members/' + target.id + '/remove?token=' + props.token;
  var removeResp = UrlFetchApp.fetch(removeUrl, {
    method: 'post',
    muteHttpExceptions: true
  });

  if (removeResp.getResponseCode() === 200) {
    postMessage_(props, 'Removed ' + target.nickname + ' from the group.');
  } else {
    postMessage_(props, 'Failed to remove ' + target.nickname + ' (error ' + removeResp.getResponseCode() + ').');
  }
}

function handleList(text, senderId) {
  var props = getProps_();

  var match = text.match(/^!list\s*(\d+)?\s*$/i);
  var limit = match && match[1] ? parseInt(match[1], 10) : null;

  var url = 'https://api.groupme.com/v3/groups/' + props.groupId + '?token=' + props.token;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (resp.getResponseCode() !== 200) {
    postMessage_(props, 'Could not fetch the member list right now.');
    return;
  }

  var members = JSON.parse(resp.getContentText()).response.members || [];
  var names = members.map(function (m) { return m.nickname; }).filter(Boolean);

  if (names.length === 0) {
    postMessage_(props, 'No members found.');
    return;
  }

  var shown = names;
  var truncated = false;
  if (limit && limit > 0 && limit < names.length) {
    shown = names.slice(0, limit);
    truncated = true;
  }

  var header = 'Members (' + shown.length + (truncated ? ' of ' + names.length : '') + '):\n';
  postMessage_(props, header + shown.join('\n'));
}

function postMessage_(props, text) {
  UrlFetchApp.fetch('https://api.groupme.com/v3/bots/post', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ bot_id: props.botId, text: text }),
    muteHttpExceptions: true
  });
}
