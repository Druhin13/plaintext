export type CoverStyle = "auto" | "casual" | "work" | "friendly" | "story" | "random";

type ScenarioStyle = Exclude<CoverStyle, "auto">;

type Scenario = {
  style: ScenarioStyle;
  situation: string;
};

const scenarios: Scenario[] = [
  { style: "casual", situation: "Text a friend that the bus is moving slowly and you will be about ten minutes late." },
  { style: "casual", situation: "Tell someone you found your keys in a jacket pocket, so they can stop looking for them." },
  { style: "casual", situation: "Mention that the bakery near the station is closed today, so you are getting something elsewhere." },
  { style: "casual", situation: "Tell a friend the parcel was left behind the side gate rather than by the front door." },
  { style: "casual", situation: "Say you are picking up groceries on the way back and ask nothing in return." },
  { style: "casual", situation: "Mention that you finally changed the light bulb in the hallway after putting it off all week." },
  { style: "casual", situation: "Tell someone you took the earlier train because the platform was already getting busy." },
  { style: "casual", situation: "Mention that the café was full, so you ended up sitting outside for a few minutes." },

  { style: "work", situation: "Tell a colleague the meeting room has changed to 3B but the meeting time is still the same." },
  { style: "work", situation: "Tell a colleague the draft is in the shared folder and only the heading still needs checking." },
  { style: "work", situation: "Mention that you moved a catch-up to later in the afternoon because the earlier slot became busy." },
  { style: "work", situation: "Tell a teammate you have added the missing figures to the document and it is ready for another look." },
  { style: "work", situation: "Let a colleague know the client sent the final images and you have put them in the project folder." },
  { style: "work", situation: "Say you will finish the small copy changes before lunch and leave the larger section for later." },
  { style: "work", situation: "Tell a colleague the call finished early and you now have a free half hour before the next meeting." },
  { style: "work", situation: "Mention that the latest file is the one dated today because the older version is still in the folder." },

  { style: "friendly", situation: "Tell a friend you saved the last slice of cake for them in the fridge." },
  { style: "friendly", situation: "Tell someone their umbrella is still at your place and you can bring it next time you meet." },
  { style: "friendly", situation: "Mention that you passed the little shop they like and it has reopened after being closed for a while." },
  { style: "friendly", situation: "Tell a friend you found the book they mentioned and picked up a copy while you were out." },
  { style: "friendly", situation: "Say the restaurant you talked about has a table free on Saturday evening." },
  { style: "friendly", situation: "Tell someone you heard the song they recommended while you were in a shop and recognised it straight away." },
  { style: "friendly", situation: "Mention that you made too much dinner and there is plenty left if they want some tomorrow." },
  { style: "friendly", situation: "Tell a friend the park is much quieter than usual this morning and the weather is better than expected." },

  { style: "story", situation: "Mention that a dog outside the corner shop was wearing a yellow raincoat and kept trying to follow people inside." },
  { style: "story", situation: "Describe noticing one empty chair in the sun outside a busy café and taking it before anyone else did." },
  { style: "story", situation: "Mention that someone left a tiny bunch of flowers on the wall beside the bus stop this morning." },
  { style: "story", situation: "Describe finding an old receipt inside a book and realising it had been there for several years." },
  { style: "story", situation: "Mention that the lift stopped at every floor even though nobody else got in." },
  { style: "story", situation: "Describe seeing a neighbour carry an enormous houseplant through a doorway that was clearly too narrow." },
  { style: "story", situation: "Mention that the lights came back on just as you had finally found a candle." },
  { style: "story", situation: "Describe a delivery driver carefully moving a snail off the path before bringing the parcel to the door." },

  { style: "random", situation: "Mention that the supermarket was completely out of lemons but had an entire shelf of limes." },
  { style: "random", situation: "Tell someone the clock in the waiting room is five minutes fast and you only noticed after checking your phone." },
  { style: "random", situation: "Mention that a single glove has been sitting on the same fence post for three days." },
  { style: "random", situation: "Say the vending machine gave you two packets instead of one and you are not sure why." },
  { style: "random", situation: "Mention that the library has moved the returns box to the opposite side of the entrance." },
  { style: "random", situation: "Tell someone the tiny plant on your desk has somehow grown a new leaf overnight." },
  { style: "random", situation: "Mention that the same bicycle has been parked outside the shop every morning this week." },
  { style: "random", situation: "Say you opened the cupboard looking for tea and found the missing tape measure instead." },
];

const fallbackCovers = [
  "The parcel turned up behind the side gate, so you can ignore my message from earlier.",
  "I found the keys in my jacket pocket, which saves us both from looking for them again.",
  "The bakery by the station is closed today, so I grabbed something from the place across the road.",
  "The bus is crawling through traffic, so I will probably be about ten minutes late.",
  "I picked up the groceries on the way back, so that is one less thing to do tomorrow.",
  "Room 3B is free after two, so I moved our catch-up there and kept the same time.",
  "The latest draft is in the shared folder, and the heading is the only bit I have not checked yet.",
  "The client sent the final images this morning, and I have added them to the project folder.",
  "I saved the last slice of cake for you, and it is still hiding at the back of the fridge.",
  "Your umbrella is still by my front door, so I can bring it next time we meet.",
  "That little shop you like has finally reopened, and it looks almost exactly the same inside.",
  "I found the book you mentioned yesterday and picked up a copy while I was out.",
  "There was one empty chair in the sun outside the café, so I took it before anyone else noticed.",
  "Someone left a tiny bunch of flowers on the wall beside the bus stop this morning.",
  "The lift stopped at every floor on the way down even though nobody else got in.",
  "The supermarket had no lemons at all, but somehow there was an entire shelf of limes.",
  "That single glove is still sitting on the same fence post for the third day in a row.",
  "I opened the cupboard looking for tea and finally found the tape measure instead.",
  "The vending machine gave me two packets for the price of one, so I am calling that a win.",
  "The park is unusually quiet this morning, and the weather is much better than I expected.",
];

const voiceInstructions: Record<CoverStyle, string> = {
  auto: "Natural everyday English. Choose the register that best fits the situation.",
  casual: "Casual text-message English. Plain, relaxed, and not polished.",
  work: "A natural message to a colleague. Professional without sounding corporate or formal.",
  friendly: "A warm message to someone familiar. Friendly without sounding sentimental.",
  story: "A brief everyday anecdote. Concrete and understated rather than dramatic or literary.",
  random: "A believable everyday message about a slightly unexpected but ordinary detail.",
};

function randomIndex(length: number) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % length;
}

function pick<T>(items: readonly T[]) {
  return items[randomIndex(items.length)];
}

function scenariosForStyle(style: CoverStyle) {
  if (style === "auto") {
    return scenarios.filter((scenario) => scenario.style !== "random");
  }
  return scenarios.filter((scenario) => scenario.style === style);
}

export function createFallbackCover() {
  return pick(fallbackCovers);
}

export function buildCoverPrompt(style: CoverStyle) {
  const available = scenariosForStyle(style);
  const scenario = pick(available.length > 0 ? available : scenarios);
  const targetWords = 10 + randomIndex(11);

  return [
    `Situation: ${scenario.situation}`,
    `Voice: ${voiceInstructions[style]}`,
    `Write one believable message of roughly ${targetWords} words. Naturalness matters more than hitting the exact count.`,
    "Use plain English, one clear point, and normal contractions when they fit.",
    "Sound like a real person who typed the message without overthinking it.",
    "Do not make it reflective, literary, quirky, overly descriptive, or assistant-like.",
    "Never mention hiding, secrets, encryption, passwords, codes, models, AI, technology, steganography, or this task.",
    "Output only the message, with no label or explanation.",
  ].join("\n");
}

export function cleanGeneratedCover(value: string) {
  return value
    .replace(/<\|[^>]+\|>/g, " ")
    .replace(/^.*?assistant\s*[:\n]/i, "")
    .replace(/^[-*\s]+/, "")
    .replace(/^['\"]|['\"]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)[0]
    .trim();
}
