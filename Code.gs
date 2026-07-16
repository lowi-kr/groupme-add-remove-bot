/**
 * GroupMe Member Management Bot (multi-group)
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
    var groupId = data.group_id;

    var ctx = getContext_(groupId);
    if (!ctx) {
      Logger.log('No bot configured for group_id: ' + groupId);
      return ContentService.createTextOutput('ok');
    }

    if (/^!add\s+/i.test(text)) {
      handleAdd(text, senderId, ctx);
    } else if (/^!remove\s+/i.test(text)) {
      handleRemove(text, senderId, ctx);
    } else if (/^!list(\s|$)/i.test(text)) {
      handleList(text, senderId, ctx);
    }
  } catch (err) {
    Logger.log('Error in doPost: ' + err);
  }
  return ContentService.createTextOutput('ok');
}

/**
 * Builds the { token, botId, groupId } context for a given incoming
 * group_id, looking up the right bot_id by scanning every script property
 * named GROUP_1, GROUP_2, etc. Returns null if that group isn't
 * configured (message is silently ignored).
 */
function getContext_(groupId) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GROUPME_ACCESS_TOKEN');

  if (!token) {
    throw new Error('Missing GROUPME_ACCESS_TOKEN script property.');
  }

  var all = props.getProperties();
  var botId = null;

  for (var key in all) {
    if (!/^GROUP_\d+$/.test(key)) continue;

    var line = all[key];

    // Strip anything after a "#" — that's a comment, not part of the data.
    var hashIndex = line.indexOf('#');
    if (hashIndex !== -1) {
      line = line.substring(0, hashIndex);
    }
    line = line.trim();
    if (!line) continue;

    var parts = line.split(',');
    if (parts.length !== 2) continue;

    var lineGroupId = parts[0].trim();
    var lineBotId = parts[1].trim();

    if (lineGroupId === String(groupId)) {
      botId = lineBotId;
      break;
    }
  }

  if (!botId) {
    return null;
  }

  return { token: token, botId: botId, groupId: groupId };
}

function isCurrentMember_(userId, ctx) {
  var url = 'https://api.groupme.com/v3/groups/' + ctx.groupId + '?token=' + ctx.token;
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

function handleAdd(text, senderId, ctx) {
  if (!isCurrentMember_(senderId, ctx)) {
    postMessage_(ctx, 'Only current group members can add people.');
    return;
  }

  var body = text.replace(/^!add\s*/i, '').trim();
  if (!body) {
    postMessage_(ctx, ADD_HELP);
    return;
  }

  var phoneInfo = extractPhone_(body);
  if (!phoneInfo) {
    postMessage_(ctx, "Couldn't find a valid phone number in that. " + ADD_HELP);
    return;
  }

  var nickname = phoneInfo.remainder.trim();
  if (!nickname) {
    postMessage_(ctx, 'Missing a name for that number. ' + ADD_HELP);
    return;
  }

  var phone = phoneInfo.normalized;

  var url = 'https://api.groupme.com/v3/groups/' + ctx.groupId + '/members/add?token=' + ctx.token;
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
    var resultsUrl = 'https://api.groupme.com/v3/groups/' + ctx.groupId +
      '/members/results/' + resultsId + '?token=' + ctx.token;
    var resultsResp = UrlFetchApp.fetch(resultsUrl, { muteHttpExceptions: true });
    if (resultsResp.getResponseCode() === 200) {
      var added = JSON.parse(resultsResp.getContentText()).response.members || [];
      if (added.length > 0) {
        postMessage_(ctx, 'Added ' + (added[0].nickname || phone) + ' to the group.');
      } else {
        postMessage_(ctx, 'Could not add ' + phone + ' — number may already be a member or invalid.');
      }
    } else {
      postMessage_(ctx, 'Add request sent for ' + phone + ', still processing.');
    }
  } else {
    postMessage_(ctx, 'Failed to add ' + phone + ' (error ' + code + ').');
  }
}

function handleRemove(text, senderId, ctx) {
  if (!isCurrentMember_(senderId, ctx)) {
    postMessage_(ctx, 'Only current group members can remove people.');
    return;
  }

  var name = text.replace(/^!remove\s*/i, '').trim().toLowerCase();
  if (!name) {
    postMessage_(ctx, 'To remove someone text: !remove John');
    return;
  }

  var url = 'https://api.groupme.com/v3/groups/' + ctx.groupId + '?token=' + ctx.token;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var members = JSON.parse(resp.getContentText()).response.members || [];

  var target = members.find(function (m) {
    return m.nickname && m.nickname.toLowerCase().indexOf(name) !== -1;
  });

  if (!target) {
    postMessage_(ctx, 'No member found matching "' + name + '".');
    return;
  }

  var removeUrl = 'https://api.groupme.com/v3/groups/' + ctx.groupId +
    '/members/' + target.id + '/remove?token=' + ctx.token;
  var removeResp = UrlFetchApp.fetch(removeUrl, {
    method: 'post',
    muteHttpExceptions: true
  });

  if (removeResp.getResponseCode() === 200) {
    postMessage_(ctx, 'Removed ' + target.nickname + ' from the group.');
  } else {
    postMessage_(ctx, 'Failed to remove ' + target.nickname + ' (error ' + removeResp.getResponseCode() + ').');
  }
}

function handleList(text, senderId, ctx) {
  var match = text.match(/^!list\s*(\d+)?\s*$/i);
  var limit = match && match[1] ? parseInt(match[1], 10) : null;

  var url = 'https://api.groupme.com/v3/groups/' + ctx.groupId + '?token=' + ctx.token;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (resp.getResponseCode() !== 200) {
    postMessage_(ctx, 'Could not fetch the member list right now.');
    return;
  }

  var members = JSON.parse(resp.getContentText()).response.members || [];
  var names = members.map(function (m) { return m.nickname; }).filter(Boolean);

  if (names.length === 0) {
    postMessage_(ctx, 'No members found.');
    return;
  }

  var shown = names;
  var truncated = false;
  if (limit && limit > 0 && limit < names.length) {
    shown = names.slice(0, limit);
    truncated = true;
  }

  var header = 'Members (' + shown.length + (truncated ? ' of ' + names.length : '') + '):\n';
  postMessage_(ctx, header + shown.join('\n'));
}

function postMessage_(ctx, text) {
  UrlFetchApp.fetch('https://api.groupme.com/v3/bots/post', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ bot_id: ctx.botId, text: text }),
    muteHttpExceptions: true
  });
}