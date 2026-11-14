import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { nextOccurrence, formatWhen } from './schedule.js';

initializeApp();
const db = getFirestore();

const APP_LINK = '/';
const ICON = '/icons/icon-192.png';

/** Send a notification to every phone in the family that has notifications on. */
async function notifyFamily(familyRef, { title, body, tag }) {
  const devices = await familyRef.collection('devices').where('notify', '==', true).get();
  const entries = devices.docs.filter((d) => d.get('token'));
  if (entries.length === 0) return 0;

  const res = await getMessaging().sendEachForMulticast({
    tokens: entries.map((d) => d.get('token')),
    notification: { title, body },
    webpush: {
      notification: {
        title,
        body,
        icon: ICON,
        badge: ICON,
        tag,
        renotify: true,
        requireInteraction: true,
      },
      fcmOptions: { link: APP_LINK },
    },
    data: { tag: tag || '' },
  });

  // Forget phones whose notification token is no longer valid.
  const cleanup = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') {
      cleanup.push(entries[i].ref.update({ notify: false, token: null }));
    }
  });
  await Promise.all(cleanup);
  return res.successCount;
}

/** Every minute: find reminders that are due and send them to JoJo. */
export const sendDueReminders = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'UTC', retryCount: 0 },
  async () => {
    const now = Date.now();
    const due = await db
      .collectionGroup('reminders')
      .where('nextNotifyAt', '<=', Timestamp.fromMillis(now))
      .limit(300)
      .get();

    for (const doc of due.docs) {
      const r = doc.data();
      const familyRef = doc.ref.parent.parent;
      const firedAt = r.nextNotifyAt.toMillis();

      // Claim the reminder first so an overlapping run can't send it twice.
      let claimed = false;
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const at = fresh.get('nextNotifyAt');
        if (!at || at.toMillis() !== firedAt) return;
        const anchor = fresh.get('anchorAt') || fresh.get('dueAt');
        const next = nextOccurrence(anchor.toMillis(), fresh.get('repeat'),
          fresh.get('timeZone'), now);
        if (next) {
          tx.update(doc.ref, {
            dueAt: Timestamp.fromMillis(next),
            nextNotifyAt: Timestamp.fromMillis(next),
            done: false,
            lastNotifiedAt: Timestamp.fromMillis(now),
          });
        } else {
          tx.update(doc.ref, { nextNotifyAt: null, lastNotifiedAt: Timestamp.fromMillis(now) });
        }
        claimed = true;
      });
      if (!claimed) continue;

      // Skip notifications that are badly stale (e.g. the server was down for hours).
      if (now - firedAt > 6 * 60 * 60 * 1000) {
        logger.warn('Skipping stale reminder', doc.ref.path);
        continue;
      }

      const body = [r.notes, r.addedBy ? `From ${r.addedBy}` : null].filter(Boolean).join(' · ');
      try {
        const sent = await notifyFamily(familyRef, {
          title: `⏰ ${r.title}`,
          body: body || 'Tap to open JoJo Reminder',
          tag: doc.id,
        });
        logger.info(`Reminder ${doc.ref.path} sent to ${sent} device(s)`);
      } catch (err) {
        logger.error('Failed to send reminder', doc.ref.path, err);
      }
    }
  }
);

/** When someone in the family adds a reminder, give JoJo a heads-up. */
export const announceNewReminder = onDocumentCreated(
  'families/{code}/reminders/{reminderId}',
  async (event) => {
    const r = event.data?.data();
    if (!r || r.announce === false) return;
    const familyRef = event.data.ref.parent.parent;
    const when = formatWhen(r.dueAt.toMillis(), r.timeZone);
    await notifyFamily(familyRef, {
      title: `New reminder${r.addedBy ? ` from ${r.addedBy}` : ''}`,
      body: `${r.title} — ${when}`,
      tag: `new-${event.params.reminderId}`,
    });
  }
);
