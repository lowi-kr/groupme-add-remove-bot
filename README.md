# GroupMe Member Management Bot

A Google Apps Script bot that lets group members add or remove people from a
GroupMe group directly from the chat — useful now that GroupMe no longer
supports adding members via SMS.

Supports being added to **multiple groups** from a single deployment.

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
- Only current members of a group can run `!add`/`!remove` there (checked
  against the sender's ID). Anyone else's message is ignored. `!list` is
  open to anyone in the group since it's read-only info everyone can
  already see in the app.

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

### 2. Create a GroupMe bot for each group

This bot can run in more than one group, but GroupMe still requires a
separate bot per group. Repeat for every group you want it in:

1. Go to [dev.groupme.com/bots](https://dev.groupme.com/bots) and create a
   new bot.
2. Choose the group you want it to manage.
3. Set the **Callback URL** to the **same** web app URL from step 1 (every
   bot, in every group, points at the same URL).
4. Save, then note that bot's **Bot ID** and its **Group ID**.

Repeat this for as many groups as you want the bot in — you'll end up with
one bot_id per group_id.

### 3. Get your access token

Go to [dev.groupme.com](https://dev.groupme.com), log in, then tap the
profile icon (circle with your initial) in the top right. A menu will drop
down with an **Access Token** row — tap **View and copy** next to it to get
your token.

This is different from the bot ID: the bot ID lets a bot post messages, but
adding/removing members requires a real account access token with
permission on that group. The same token needs to have access to every
group you're adding this bot to (i.e. you need to be a member of all of
them under the account this token belongs to).

Treat this token like a password. Don't share it or commit it anywhere.

### 4. Store your credentials as Script Properties

In the Apps Script editor:

1. Click the gear icon (**Project Settings**) in the left sidebar.
2. Scroll to **Script Properties**.
3. Add these properties. `GROUPME_ACCESS_TOKEN` is one property. Each
   group gets its own separate property, named `GROUP_1`, `GROUP_2`,
   `GROUP_3`, and so on — the Script Properties editor only accepts a
   single line per value, so this is how you list multiple groups:

   | Property                | Value                                                        |
   |--------------------------|---------------------------------------------------------------|
   | `GROUPME_ACCESS_TOKEN`   | your access token from step 3                                  |
   | `GROUP_1`                | `group_id,bot_id` for your first group                        |
   | `GROUP_2`                | `group_id,bot_id` for your second group                       |
   | `GROUP_3`, `GROUP_4`, ... | one more property per additional group                       |

   Each `GROUP_#` value is just `group_id,bot_id` — no quotes, no braces,
   no JSON. Add a `#` followed by anything as a comment (like the group's
   name) so you can tell them apart later — everything after the `#` is
   ignored:

   ```
   GROUP_1 = 12345678,abcd1234botid   # Family Group
   GROUP_2 = 87654321,efgh5678botid   # Work Friends
   ```

The script reads these at runtime — nothing is hardcoded in `Code.gs`, so
it's safe to make this repo public.

### 5. Test it

In any configured group's chat, try:

```
!add Test User 5555555555
```

You should see a confirmation message from the bot within a few seconds. If
nothing happens, check:

- The deployment's **Who has access** is set to "Anyone."
- You're using the `/exec` URL, not `/dev`.
- The group's `group_id` is actually listed correctly in one of your
  `GROUP_#` properties (typos here mean the message is silently ignored).
- The `Executions` log in the Apps Script editor (left sidebar) for errors.

## Adding another group later

1. Create a new bot in that group pointing at the same web app URL.
2. Add a new Script Property named `GROUP_3` (or the next unused number)
   with that group's `group_id,bot_id` (and optionally a `# comment` with
   the group's name) — no code changes or redeploy needed.

## How it works

GroupMe POSTs every group message to the bot's callback URL, including
which group it came from (`group_id`). The script looks up the right
bot_id for that group from the matching `GROUP_#` property, then checks
incoming messages for
`!add`, `!remove`, or `!list`:

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