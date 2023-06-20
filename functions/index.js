import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as cron from 'node-cron';

import { createClient } from '@google/maps';

import { Configuration, OpenAIApi } from 'openai';
import { possibleSkills } from './possibleSkills.js';

const configuration = new Configuration({
  apiKey: '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',
  // organization: 'org-B2GOWYIVeBxxQfUioQimVSW6',
});
const openai = new OpenAIApi(configuration);

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
  console.log('newSkills', newSkills);
  const targetPrice = Number(req.query.price) || null;

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

  // if (newSkills) {
  //   await userRef.update({ userSkills: newSkills });
  //   userData.userSkills = newSkills;
  // }

  let coworkingsSnap = await db.collection('coworkings').get();

  let coworkings = await Promise.all(
    coworkingsSnap.docs.map(async (doc, index) => {
      let data = doc.data();
      data.id = doc.id;
      data.idIndex = index;

      data.averagePrice = await getAveragePrice(db, doc.id);
      data.skillsStatistic = await getUsersSkillsStat(db, doc.id);

      return data;
    })
  );

  if (newSkills) {
    const skillsAnalysis = await getCoworkingsStatSkillsTopicAnalysis(coworkings, newSkills);
    coworkings = coworkings.map((coworking) => {
      const analysis = skillsAnalysis.find(analysis => analysis.id === coworking.id);
      if (analysis) coworking.skillAnalysisTopic = analysis.topic;
      return coworking;
    });
  }

  console.log(
    'stat',
    coworkings.map((c) => c.skillsStatistic)
  );

  // Use Google Distance Matrix API to calculate the distances
  const distances = await calculateDistances(userData.location, coworkings);

  // Sort the coworkings by distance and skillAnalysisTopic
  coworkings.sort((a, b) => {
    if (a.skillAnalysisTopic && !b.skillAnalysisTopic) return -1;
    if (!a.skillAnalysisTopic && b.skillAnalysisTopic) return 1;

    return distances[a.idIndex] - distances[b.idIndex];
  });

  if (targetPrice) {
    coworkings.sort((a, b) => Math.abs(a.averagePrice - targetPrice) - Math.abs(b.averagePrice - targetPrice));
  }

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

const getAveragePrice = async (db, coworkingId) => {
  const workplaceSnap = await db
    .collection('workingPlaces')
    .where('coworkingId', '==', coworkingId)
    .where('availableDates', '!=', {})
    .get();

  const prices = workplaceSnap.docs.map((doc) => doc.data().pricePerHour);

  let averagePrice;
  if (prices.length === 0) {
    // use the provided fallback calculation
    const seats = Math.floor(Math.random() * 5) + 1;
    averagePrice = seats * 10 + Math.floor(Math.random() * 21) - 10;
  } else {
    averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  console.log('averagePrice', averagePrice, coworkingId);

  return averagePrice;
}

const getUsersSkillsStat = async (db, coworkingId) => {
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

  if (Object.keys(skillsStat).length === 0) {
    return getPossibleSkills();
  }

  return skillsStat;
}

const getPossibleSkills = () => {
  const numSkills = Math.floor(Math.random() * 7) + 1;
  const result = {};
  for (let i = 0; i < numSkills; i++) {
    const skillIndex = Math.floor(Math.random() * possibleSkills.length);
    const skillPower = Math.floor(Math.random() * 25) + 1;
    result[possibleSkills[skillIndex]] = skillPower;
  }
  return result;
}

const getCoworkingsStatSkillsTopicAnalysis = async (coworkings, skills) => {
  const coworkingsSkillsStatistic = coworkings.map(coworking => {
    return { id: coworking.id, statistics: coworking.skillsStatistic };
  });

  console.log(skills.join(", "));
  console.log(JSON.stringify(coworkingsSkillsStatistic));

  const prompt = `Given a user with the skills [${skills.join(", ")}], and coworking space skill statistics ${JSON.stringify(coworkingsSkillsStatistic)}, select between one to three coworking spaces whose skills best match those of the user. Each selected coworking space must be unique. For each selected coworking space, also identify the skill topic that most closely matches the user's skills. Your returned text should be in one of the following formats : [{"id": "fullId1", "topic": "Matched Topic"}] or [{"id": "fullId1", "topic": "Matched Topic"}, {"id": "fullId2", "topic": "Matched Topic"}] or [{"id": "fullId1", "topic": "Matched Topic"}, {"id": "fullId2", "topic": "Matched Topic"}, {"id": "fullId3", "topic": "Matched Topic"}].`;

  console.log(prompt);

  const response = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: prompt,
    temperature: 0.2,
    max_tokens: 200
  });

  const match = response.data.choices[0].text.trim().match(/\[.*\]/);
  const skillsAnalysis = JSON.parse(match[0]);
  console.log('skillsAnalysis', skillsAnalysis);

  return skillsAnalysis;
}