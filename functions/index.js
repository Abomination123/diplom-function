import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as cron from 'node-cron';

initializeApp();

cron.schedule('0 0 */2 * * *', async () => {
  const bookingsSnap = await getFirestore()
    .collection('bookings')
    .where('status', '==', 'active')
    .get();

  const promises = [];

  bookingsSnap.forEach((doc) => {
    const data = doc.data();
    const bookingDate = new Date(data.date);
    const bookingEndTime = new Date(
      bookingDate.getFullYear(),
      bookingDate.getMonth(),
      bookingDate.getDate(),
      data.timeSlot.endTime.hour,
      data.timeSlot.endTime.minute
    );

    if (bookingEndTime < new Date()) {
      promises.push(
        getFirestore()
          .collection('bookings')
          .doc(doc.id)
          .update({ status: 'completed' })
      );
    }
  });

  await Promise.all(promises);
});

export const updateBookings = onRequest(async (req, res) => {
  try {
    res.send('Cron job scheduled to update booking status.');
  } catch (error) {
    console.error(error);
    res.status(500).send(error);
  }
});

export const getCoworkings = onRequest(async (req, res) => {
  const userId = req.query.userId;
  const page = req.query.page || null;
  const location = req.query.location || null;
  const newSkills = req.query.newSkills?.split(',') || null;

  const db = getFirestore();

  // Fetch the user's data from Firestore
  const userRef = db.collection('users').doc(userId);
  const userSnapshot = await userRef.get();
  let userData = userSnapshot.data();

  if (!userData) {
    userData = {};
  }

  if (!userData.location) {
    await userRef.set({ ...userData, location: 'Kyiv, Khreshchatyk 1' });
    userData.location = 'Kyiv, Khreshchatyk 1';
  }

  if (location) {
    await userRef.update({ location });
    userData.location = location;
  }

  if (newSkills) {
    await userRef.update({ skills: newSkills });
    userData.skills = newSkills;
  }

  let coworkingsSnap = await db.collection('coworkings').get();

  let coworkings = coworkingsSnap.docs.map((doc) => doc.data());

  if (page) {
    const half = Math.ceil(coworkings.length / 2);
    if (page === '1') {
      coworkings = coworkings.slice(0, half);
    } else if (page === '2') {
      coworkings = coworkings.slice(half, coworkings.length);
    }
  }

  res.json({ coworkings });
});
