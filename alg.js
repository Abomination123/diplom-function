// const userData = {
//   location: 'Київ',
//   skills: ['JavaScript', 'React', 'Node.js'],
// };

// const coworkingData = [
//   {
//     id: 1,
//     name: 'Coworking A',
//     location: 'Київ',
//     events: [
//       {
//         topic: 'JavaScript',
//         date: '2023-05-05T18:00:00',
//       },
//     ],
//     visitors: [
//       {
//         skills: ['JavaScript', 'Node.js'],
//         visitFrequency: 5,
//       },
//     ],
//   },
//   {
//     id: 2,
//     name: 'Coworking B',
//     location: 'Київ',
//     events: [
//       {
//         topic: 'React',
//         date: '2023-05-07T19:00:00',
//       },
//     ],
//     visitors: [
//       {
//         skills: ['JavaScript', 'React'],
//         visitFrequency: 3,
//       },
//     ],
//   },
// ];

// const natural = require('natural');
// const { WordNet, WordTokenizer } = natural;
// const wordnet = new WordNet();
// const tokenizer = new WordTokenizer();
// const util = require('util');

// const wordnetLookup = util.promisify(wordnet.lookup.bind(wordnet));

// async function lemmatize(word) {
//   const results = await wordnetLookup(word);

//   if (results.length > 0) {
//     return results[0].lemma;
//   } else {
//     return word;
//   }
// }

// async function lemmatizeSkills(skills) {
//   const lemmatizedSkills = [];

//   for (const skill of skills) {
//     const tokens = tokenizer.tokenize(skill);
//     const lemmatizedTokens = await Promise.all(
//       tokens.map((token) => lemmatize(token))
//     );
//     lemmatizedSkills.push(lemmatizedTokens.join(' '));
//   }

//   return lemmatizedSkills;
// }

// const calculateMatchScore = (userSkills, coworkingVisitors) => {
//   let totalScore = 0;

//   for (const visitor of coworkingVisitors) {
//     let sharedSkills = 0;

//     for (const skill of userSkills) {
//       if (visitor.skills.includes(skill)) {
//         sharedSkills++;
//       }
//     }
//     totalScore += sharedSkills * visitor.visitFrequency;
//   }
//   return totalScore;
// };

// async function sortCoworkingsByNetworkingPotential(userData, coworkingData) {
//   const lemmatizedUserSkills = await lemmatizeSkills(userData.skills);

//   return coworkingData
//     .map((coworking) => {
//       const matchScore = calculateMatchScore(
//         lemmatizedUserSkills,
//         coworking.visitors
//       );
//       const eventsScore = coworking.events.filter((event) =>
//         lemmatizedUserSkills.includes(event.topic)
//       ).length;

//       return {
//         ...coworking,
//         score: matchScore + eventsScore,
//       };
//     })
//     .sort((a, b) => b.score - a.score);
// }

// (async () => {
//   const sortedCoworkings = await sortCoworkingsByNetworkingPotential(
//     userData,
//     coworkingData
//   );
//   console.log(sortedCoworkings);
// })();

// async function getCoworkingRecommendations(userId) {
//   const user = await User.findById(userId).lean();
//   const coworkings = await Coworking.find().lean();

//   // Preprocess user's skills
//   let userSkills = [];
//   for (const skill of user.skills) {
//     userSkills.push(await lemmatize(skill));
//   }

//   // Content-Based Filtering: Find coworkings with relevant events
//   let relevantCoworkings = [];
//   for (const coworking of coworkings) {
//     const events = await Event.find({ coworkingId: coworking._id }).lean();
//     for (const event of events) {
//       let eventTopics = [];
//       for (const topic of event.topics) {
//         eventTopics.push(await lemmatize(topic));
//       }

//       // If the event topics match with the user's skills, add the coworking to the list
//       if (eventTopics.some((topic) => userSkills.includes(topic))) {
//         relevantCoworkings.push(coworking);
//         break; // move to the next coworking
//       }
//     }
//   }

//   // Collaborative Filtering: Find coworkings visited by similar users
//   const similarUsers = await User.find({ skills: { $in: userSkills } }).lean();
//   let similarUserCoworkings = [];
//   for (const similarUser of similarUsers) {
//     similarUserCoworkings.push(...similarUser.visitedCoworkings);
//   }

//   // Calculate scores for coworkings based on both relevance of events and visits by similar users
//   const coworkingScores = {};
//   for (const coworking of relevantCoworkings) {
//     const score = similarUserCoworkings.filter(
//       (id) => id.toString() === coworking._id.toString()
//     ).length;
//     coworkingScores[coworking._id] = score;
//   }

//   // Sort coworkings by their scores in descending order
//   const sortedCoworkings = relevantCoworkings.sort(
//     (a, b) => coworkingScores[b._id] - coworkingScores[a._id]
//   );

//   return sortedCoworkings;
// }
