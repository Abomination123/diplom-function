import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as cron from 'node-cron';

import { createClient } from '@google/maps';

const googleMapsClient = createClient({
  key: 'AIzaSyDl-mSwF1zuYFJ5j_Wg8JovyxvASjsoGGw',
  Promise: Promise,
});

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

  const reslts = await Promise.all(promises);
  console.log(reslts);
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
    res.status(404).json({ error: 'User not found' });
    return;
    // userData = {};
  }

  if (!userData.location) {
    await userRef.set({
      ...userData,
      location: location ?? 'Kyiv, Khreshchatyk 1',
    });
    userData.location = location ?? 'Kyiv, Khreshchatyk 1';
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

  let coworkings = await Promise.all(
    coworkingsSnap.docs.map(async (doc, index) => {
      let data = doc.data();
      // data.id = doc.id;
      data.idIndex = index;

      data.averagePrice = await getAveragePrice(db, doc.id);
      data.skillsStatistic = await getUserSkills(db, doc.id);

      return data;
    })
  );

  // Use Google Distance Matrix API to calculate the distances
  // const distances = await calculateDistances(userData.location, coworkings);

  // Sort the coworkings by distance
  // coworkings.sort((a, b) => distances[a.idIndex] - distances[b.idIndex]);
  console.log(
    'stat',
    coworkings.map((c) => c.skillsStatistic)
  );

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

const calculateDistances = async (userLocation, coworkings) => {
  // Convert the coworkings to an array of destination coordinates
  const destinations = coworkings.map((coworking) => coworking.location);
  // console.log('destinations', destinations);

  // Request the distance matrix

  try {
    const response = await googleMapsClient
      .distanceMatrix({
        origins: [userLocation],
        destinations,
        mode: 'driving',
      })
      .asPromise();

    // Convert the response to a dictionary mapping coworking ids to distances
    const distances = {};
    response.json.rows[0].elements.forEach((element, i) => {
      distances[coworkings[i].idIndex] = element.distance.value;
    });
    // console.log(distances);
    return distances;
  } catch (e) {
    console.error(e);
    return e;
  }
};

async function getAveragePrice(db, coworkingId) {
  const workplaceSnap = await db
    .collection('workingPlaces')
    .where('coworkingId', '==', coworkingId)
    .where('availableDates', '!=', {})
    .get();

  const prices = workplaceSnap.docs.map((doc) => doc.data().pricePerHour);
  console.log('prices', prices, coworkingId);
  const averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  return averagePrice;
}

async function getUserSkills(db, coworkingId) {
  const bookingSnap = await db
    .collection('bookings')
    .where('coworkingId', '==', coworkingId)
    .get();

  const skillsStat = {};

  for (let doc of bookingSnap.docs) {
    const userId = doc.data().userId;
    const userSnap = await db.collection('users').doc(userId).get();
    const skills = userSnap.data().userSkills || [];

    for (let skill of skills) {
      if (!skillsStat[skill]) {
        skillsStat[skill] = 1;
      }
      skillsStat[skill]++;
    }
  }

  return skillsStat;
}
