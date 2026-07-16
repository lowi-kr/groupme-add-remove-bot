# GroupMe Member Management Bot

A Google Apps Script bot that lets group members add or remove people from a
GroupMe group directly from the chat — useful now that GroupMe no longer
supports adding members via SMS.

## Commands

```
!add John +15555555555
!add John (555) 555-5555
!add John 555-555-5555
!add John 5555555555

!remove Jordan

!list
!list 5
```

- `!add` accepts a name followed by a US phone number in any common format
  (with or without country code, dashes, dots, spaces, or parentheses).
  Only US numbers are supported — this matches GroupMe's own SMS/add
  behavior, which is US-only.
- `!remove` matches against the current group's member nicknames
  (case-insensitive, partial match).
- `!list` shows every member's nickname, so you can confirm an add/remove
  actually took effect (GroupMe doesn't otherwise notify the group when
  membership changes). `!list 5` shows only the first 5 names — replace 5
  with any number.
- Only current members of the group can run `!add`/`!remove` (checked
  against the sender's ID). Anyone else's message is ignored. `!list` is
  open to anyone in the group since it's read-only info everyone can
  already see in the app.
- If a command is malformed or a phone number can't be parsed, the bot
  replies with a short help message instead of failing silently.

## Setup

### 1. Deploy the script

1. Go to [script.google.com](https://script.google.com) and create a new
   project.
2. Paste the contents of `Code.gs` into the editor.
3. Click **Deploy > New deployment**.
4. Select type **Web app**.
5. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
6. Click **Deploy** and copy the resulting web app URL (it ends in `/exec`).

Any time you edit the script afterward, you need to create a new deployment
(or update the existing one) for the changes to take effect — the `/exec`
URL only picks up the version it was created against.

### 2. Create the GroupMe bot

1. Go to [dev.groupme.com/bots](https://dev.groupme.com/bots) and create a
   new bot.
2. Choose the group you want it to manage.
3. Set the **Callback URL** to the web app URL from step 1.
4. Save, then note the bot's **Bot ID** and the group's **Group ID**.

### 3. Get your access token

Go to [dev.groupme.com](https://dev.groupme.com) and log in — your access
token is shown at the top of the page. This is different from the bot ID:
the bot ID lets the bot post messages, but adding/removing members requires
a real account access token with permission on that group.

Treat this token like a password. Don't share it or commit it anywhere.

### 4. Store your credentials as Script Properties

In the Apps Script editor:

1. Click the gear icon (**Project Settings**) in the left sidebar.
2. Scroll to **Script Properties**.
3. Add these three properties:

   | Property              | Value                          |
   |------------------------|---------------------------------|
   | `GROUPME_ACCESS_TOKEN` | your access token from step 3   |
   | `GROUPME_BOT_ID`       | your bot ID from step 2         |
   | `GROUPME_GROUP_ID`     | your group ID from step 2       |

The script reads these at runtime — nothing is hardcoded in `Code.gs`, so
it's safe to make this repo public.

### 5. Test it

In the group chat, try:

```
!add Test User 5555555555
```

You should see a confirmation message from the bot within a few seconds. If
nothing happens, check:

- The deployment's **Who has access** is set to "Anyone."
- You're using the `/exec` URL, not `/dev`.
- The Script Property names match exactly (case-sensitive).
- The `Executions` log in the Apps Script editor (left sidebar) for errors.

## How it works

GroupMe POSTs every group message to the bot's callback URL. The script
checks incoming messages for `!add` or `!remove`, and:

- **Add:** parses out a US phone number, treats the remaining text as the
  nickname, and calls GroupMe's `POST /groups/:id/members/add` endpoint.
  Since that endpoint is asynchronous, the script briefly polls the
  `members/results` endpoint to confirm success before replying.
- **Remove:** looks up the group's current member list, finds a nickname
  match, and calls `POST /groups/:id/members/:user_id/remove`.
- **List:** fetches the group's current member list and replies with each
  nickname, optionally truncated to the number given (e.g. `!list 5`).

## License

MIT — see [LICENSE](LICENSE).
