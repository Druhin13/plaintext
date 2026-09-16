export type CoverStyle = "auto" | "casual" | "work" | "friendly" | "story" | "random";
export type CoverLanguage = "en" | "bn" | "hi" | "es" | "fr" | "de" | "ar";

type ScenarioStyle = Exclude<CoverStyle, "auto">;

type Scenario = {
  style: ScenarioStyle;
  situation: string;
};

type LanguageConfig = {
  value: CoverLanguage;
  label: string;
  promptName: string;
  instruction: string;
};

export const COVER_LANGUAGES: readonly LanguageConfig[] = [
  {
    value: "en",
    label: "English",
    promptName: "English",
    instruction: "Write natural everyday English.",
  },
  {
    value: "bn",
    label: "বাংলা",
    promptName: "Bengali (বাংলা)",
    instruction: "Write natural conversational Bengali in Bengali script, not transliterated Bengali.",
  },
  {
    value: "hi",
    label: "हिन्दी",
    promptName: "Hindi (हिन्दी)",
    instruction: "Write natural conversational Hindi in Devanagari script, not transliterated Hindi.",
  },
  {
    value: "es",
    label: "Español",
    promptName: "Spanish (Español)",
    instruction: "Write natural everyday Spanish that sounds native rather than translated.",
  },
  {
    value: "fr",
    label: "Français",
    promptName: "French (Français)",
    instruction: "Write natural everyday French that sounds native rather than translated.",
  },
  {
    value: "de",
    label: "Deutsch",
    promptName: "German (Deutsch)",
    instruction: "Write natural everyday German that sounds native rather than translated.",
  },
  {
    value: "ar",
    label: "العربية",
    promptName: "Arabic (العربية)",
    instruction: "Write natural conversational Modern Standard Arabic in Arabic script, not transliteration.",
  },
] as const;

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

const fallbackCovers: Record<CoverLanguage, readonly string[]> = {
  en: [
    "The parcel turned up behind the side gate, so you can ignore my message from earlier.",
    "I found the keys in my jacket pocket, which saves us both from looking for them again.",
    "The bakery by the station is closed today, so I grabbed something from the place across the road.",
    "The bus is crawling through traffic, so I will probably be about ten minutes late.",
    "Your umbrella is still by my front door, so I can bring it next time we meet.",
    "The park is unusually quiet this morning, and the weather is much better than I expected.",
  ],
  bn: [
    "বাসটা আজ খুব ধীরে চলছে, তাই আমার পৌঁছাতে দশ মিনিটের মতো দেরি হবে।",
    "চাবিগুলো জ্যাকেটের পকেটেই ছিল, তাই আর খুঁজতে হবে না।",
    "স্টেশনের পাশের বেকারিটা আজ বন্ধ, তাই রাস্তার ওপারের দোকান থেকে কিছু নিয়ে নিলাম।",
    "পার্সেলটা সামনের দরজায় নয়, পাশের গেটের পেছনে রেখে গেছে।",
    "তোমার ছাতাটা এখনও আমার বাসায় আছে, পরেরবার দেখা হলে নিয়ে আসব।",
    "আজ সকালে পার্কটা বেশ শান্ত, আর আবহাওয়াও ভাবনার চেয়ে ভালো।",
  ],
  hi: [
    "आज बस बहुत धीरे चल रही है, इसलिए मुझे पहुँचने में करीब दस मिनट देर होगी।",
    "चाबियाँ जैकेट की जेब में ही थीं, अब उन्हें ढूँढने की जरूरत नहीं है।",
    "स्टेशन के पास वाली बेकरी आज बंद है, इसलिए मैंने सामने वाली दुकान से कुछ ले लिया।",
    "पार्सल सामने के दरवाज़े पर नहीं, साइड गेट के पीछे रखा है।",
    "तुम्हारी छतरी अभी भी मेरे यहाँ है, अगली बार मिलेंगे तो साथ ले आऊँगा।",
    "आज सुबह पार्क काफी शांत है और मौसम भी उम्मीद से बेहतर है।",
  ],
  es: [
    "El autobús va muy lento, así que llegaré unos diez minutos tarde.",
    "Las llaves estaban en el bolsillo de la chaqueta, así que ya no hace falta buscarlas.",
    "La panadería de la estación está cerrada hoy, así que compré algo en el local de enfrente.",
    "El paquete está detrás de la puerta lateral, no junto a la entrada principal.",
    "Tu paraguas sigue en mi casa, así que te lo llevo la próxima vez que nos veamos.",
    "El parque está muy tranquilo esta mañana y hace mejor tiempo de lo que esperaba.",
  ],
  fr: [
    "Le bus avance très lentement, donc j'aurai environ dix minutes de retard.",
    "Les clés étaient dans la poche de ma veste, donc plus besoin de les chercher.",
    "La boulangerie près de la gare est fermée aujourd'hui, alors j'ai pris quelque chose en face.",
    "Le colis a été laissé derrière le portail sur le côté, pas devant la porte.",
    "Ton parapluie est toujours chez moi, je te le rapporterai la prochaine fois.",
    "Le parc est vraiment calme ce matin et il fait meilleur que prévu.",
  ],
  de: [
    "Der Bus fährt heute sehr langsam, deshalb komme ich ungefähr zehn Minuten später.",
    "Die Schlüssel waren in meiner Jackentasche, also müssen wir nicht mehr danach suchen.",
    "Die Bäckerei am Bahnhof ist heute zu, deshalb habe ich gegenüber etwas geholt.",
    "Das Paket liegt hinter dem Seitentor und nicht vor der Haustür.",
    "Dein Regenschirm ist noch bei mir, ich bringe ihn beim nächsten Mal mit.",
    "Der Park ist heute Morgen ungewöhnlich ruhig und das Wetter ist besser als erwartet.",
  ],
  ar: [
    "الحافلة تسير ببطء اليوم، لذلك سأتأخر حوالي عشر دقائق.",
    "وجدت المفاتيح في جيب السترة، لذلك لا داعي للبحث عنها أكثر.",
    "المخبز القريب من المحطة مغلق اليوم، فأخذت شيئًا من المتجر المقابل.",
    "تم ترك الطرد خلف البوابة الجانبية وليس أمام الباب الرئيسي.",
    "مظلتك ما زالت عندي، وسأحضرها معي في المرة القادمة التي نلتقي فيها.",
    "الحديقة هادئة جدًا هذا الصباح والطقس أفضل مما توقعت.",
  ],
};

const voiceInstructions: Record<CoverStyle, string> = {
  auto: "Choose the register that best fits the situation. Keep it ordinary, direct, and believable.",
  casual: "Casual and relaxed, like a normal text message.",
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

function languageConfig(language: CoverLanguage) {
  return COVER_LANGUAGES.find((option) => option.value === language) ?? COVER_LANGUAGES[0];
}

export function createFallbackCover(language: CoverLanguage = "en") {
  return pick(fallbackCovers[language] ?? fallbackCovers.en);
}

export function buildCoverPrompt(style: CoverStyle, language: CoverLanguage = "en") {
  const available = scenariosForStyle(style);
  const scenario = pick(available.length > 0 ? available : scenarios);
  const targetWords = 10 + randomIndex(11);
  const selectedLanguage = languageConfig(language);

  return [
    `Target language: ${selectedLanguage.promptName}.`,
    selectedLanguage.instruction,
    `Situation: ${scenario.situation}`,
    `Voice: ${voiceInstructions[style]}`,
    `Write one believable message of roughly ${targetWords} words. Naturalness matters more than hitting the exact count.`,
    "Write how a native speaker would actually send this message rather than translating the situation word for word.",
    "Keep one clear point and use normal everyday phrasing.",
    "Sound like a real person who typed the message without overthinking it.",
    "Do not make it reflective, literary, quirky, overly descriptive, or assistant-like.",
    "Never mention hiding, secrets, encryption, passwords, codes, models, AI, technology, steganography, or this task.",
    `Output only the message in ${selectedLanguage.promptName}, with no label, translation, or explanation.`,
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
    .split(/(?<=[.!?।؟])\s+/u)[0]
    .trim();
}
