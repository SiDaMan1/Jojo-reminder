# 🔔 JoJo Reminder

A simple family reminder app. Anyone in the family can add reminders to **JoJo's list**, and JoJo's phone gets a notification when each one is due.

- Works on **iPhone and Android**. It's a web app you add to the Home Screen, so there's no App Store and nothing to approve.
- Big text and big buttons, so it's easy for JoJo to use.
- Reminders can be **one time** or repeat **every day, week, month or year**.
- When someone adds a reminder, JoJo gets a heads-up like "New reminder from Sam: Dentist on Tue at 3 PM".
- JoJo taps the circle ✓ when she's done. Repeating reminders move on to the next time automatically.
- The family shares one list using a **family code** (for example `JOJO-AB12-CD34-EF56`).

## How it works

```
Family phones ──add reminders──▶  Firebase database  ◀──reads list── JoJo's phone
                                        │                                 ▲
                         Cloud Function checks every minute               │
                                        └─────── push notification ───────┘
```

| Folder / file | What it is |
|---|---|
| `public/` | The app people open on their phones |
| `functions/` | The server code that sends notifications when reminders are due |
| `firestore.rules` | Security: only people with the family code can see or change the list |

---

## One-time setup (about 20 minutes)

You need a free Google account and a computer with [Node.js](https://nodejs.org) installed.

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and click **Add project**. Name it something like `jojo-reminder`.
2. **Upgrade to the Blaze (pay-as-you-go) plan** (bottom-left ⚙️ → *Usage and billing*). Google requires this for the scheduled notification function. A family this size stays well inside the free allowance, so expect **$0/month**. You can set a budget alert of $1 to be safe.
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
4. **Build → Firestore Database → Create database** (production mode; choose a location near you).

### 2. Connect the app to your project
1. In Firebase, go to ⚙️ **Project settings → General → Your apps**. Click the **`</>` (Web)** icon and register an app called "JoJo Reminder". Copy the `firebaseConfig` values it shows you.
2. Go to ⚙️ **Project settings → Cloud Messaging → Web Push certificates** and click **Generate key pair**. Copy the key.
3. Paste both into **`public/firebase-config.js`**.
4. In **`.firebaserc`**, replace `your-firebase-project-id` with your project ID.

### 3. Deploy
```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy
```
When it finishes, it prints your app's web address, like `https://jojo-reminder.web.app`. That's the link everyone uses.

---

## Putting it on JoJo's phone

**iPhone (iOS 16.4 or newer):**
1. Open the link in **Safari**.
2. Tap **Share ⬆️ → Add to Home Screen → Add**.
3. Open **JoJo** from the Home Screen (not from Safari). This step matters because iPhones only allow notifications for apps opened from the Home Screen.
4. Tap **"This is JoJo's phone"**, choose **Start a new family list**, then tap **Turn on → Allow**.

**Android:**
1. Open the link in **Chrome**. Tap **⋮ → Add to Home screen** (or *Install app*).
2. Open it, tap **"This is JoJo's phone"**, then **Turn on → Allow**.

Then open ⚙️ **Settings → Send a test reminder**. A notification should appear in about a minute. 🎉

> **Tip:** Make sure JoJo's phone doesn't have **Focus / Do Not Disturb** blocking the JoJo app, and on Android, that battery saver isn't restricting Chrome.

## Adding family members

On JoJo's phone (or any family phone already set up), go to ⚙️ **Settings → Share invite link** and text it to family. They open the link, add it to their Home Screen, tap **"I'm family"**, and type their name. The family code fills itself in.

Family members can add, edit, and delete reminders. If they also want the notifications on their own phone, they can tap **Turn on notifications here** in Settings.

---

## For developers

- Run the scheduling tests: `cd functions && npm test`
- The front end is plain HTML, CSS and JS with no build step. It loads Firebase from Google's CDN.
- Data lives at `families/{code}/reminders/{id}` and `families/{code}/devices/{deviceId}`.
- `sendDueReminders` runs every minute. It sends any reminder whose `nextNotifyAt` has passed, then moves repeating reminders to their next time. Repeats are calculated in the time zone of whoever created the reminder, so "9 AM every day" stays at 9 AM through daylight saving changes.
- Security model: the family code is the shared secret, like a hard-to-guess link. Keep it within the family.
