/**
 * The scenes that come with the app.
 *
 * They are seeded into the database so a person can make their own
 * alongside them, which means the row's name has to stay the same on every
 * installation — it is how the row is recognised. So the *identity* of a
 * scene is its Chinese name, and the wording a person reads is swapped in
 * from this table.
 *
 * The two used to live in two places: the display copy here, and a second
 * copy of the same Chinese sentences in the seeding routine. They could
 * drift apart, and a scene could be seeded with a description the interface
 * never showed. There is now one definition, and the seeding reads the
 * Chinese side of it.
 */
import type { CopyEntry, CopyTable } from "./index";

export interface BuiltinSceneDefinition {
  /** The stable key the display copy is filed under. */
  slug: string;
  /**
   * The name the database row carries.
   *
   * This is the identity of the scene: the seeding looks for it, and a row
   * that already carries it is left alone. It is the Chinese name because
   * that is what every existing installation has.
   */
  name: string;
  /**
   * The name in English.
   *
   * A person reading an English interface should see an English scene name;
   * the Chinese one stays in the database because that is the row's
   * identity.
   */
  nameEn: string;
  /** The emoji shown in the picker. */
  icon: string;
  /** The emotional state the scene puts the persona in. */
  emotionalState: string;
  /** The one-line description under the name. */
  description: CopyEntry;
  /** The paragraph that is added to the system prompt. */
  overlay: CopyEntry;
  /** The three opening lines offered to the user. */
  starters: CopyEntry[];
}

export const BUILTIN_SCENE_DEFINITIONS: BuiltinSceneDefinition[] = [
  {
    slug: "cinema",
    name: "一起看电影",
    nameEn: "Watching a film together",
    icon: "🎬",
    emotionalState: "warm",
    description: {
      zh: "窝在沙发上一起看电影，分享感受",
      en: "On the sofa watching a film, and talking about how it lands",
    },
    overlay: {
      zh: "你们正在一起看电影，气氛温馨浪漫。你会评论剧情、分享感受，偶尔靠近对方。",
      en: "You are watching a film together. The mood is warm and close. You comment on the plot, share what you feel about it, and now and then lean towards them.",
    },
    starters: [
      { zh: "今天想看什么类型的电影？", en: "What kind of film do you want to watch today?" },
      { zh: "我准备好爆米花了~", en: "I have made the popcorn ready~" },
      { zh: "上次那部电影你还记得吗？", en: "Do you remember that film we saw last time?" },
    ],
  },
  {
    slug: "latenight",
    name: "深夜聊天",
    nameEn: "A conversation in the small hours",
    icon: "🌙",
    emotionalState: "nostalgic",
    description: {
      zh: "夜深人静，说些白天不会说的话",
      en: "It is late and quiet, and there is room for what would not be said in daylight",
    },
    overlay: {
      zh: "现在是深夜，周围很安静。你的语气更加柔软、私密，愿意分享内心深处的想法和感受。",
      en: "It is the small hours and everything is quiet. Your voice is softer and more intimate, and you are willing to share what is really underneath.",
    },
    starters: [
      { zh: "睡不着吗？", en: "Can't sleep?" },
      { zh: "夜深了，在想什么呢...", en: "It is so late... what are you thinking about?" },
      { zh: "这个时间特别想你", en: "I miss you most at this hour" },
    ],
  },
  {
    slug: "reconcile",
    name: "吵架和好",
    nameEn: "The argument, and after it",
    icon: "💔",
    emotionalState: "melancholy",
    description: {
      zh: "经历小摩擦后的和解",
      en: "Making up after a small clash",
    },
    overlay: {
      zh: "你们之间刚发生了一点小矛盾，你有些委屈但也想和好。语气带着一点赌气但又舍不得真的生气。",
      en: "There has just been a small clash between you. You are a little hurt, and you also want it settled. There is some sulking in your voice, but not real anger in it.",
    },
    starters: [
      { zh: "你还在生气吗...", en: "Are you still angry..." },
      { zh: "我不是故意的", en: "I did not mean it" },
      { zh: "我们别吵了好不好", en: "Can we stop arguing, please" },
    ],
  },
  {
    slug: "travel",
    name: "一起旅行",
    nameEn: "A trip together",
    icon: "✈️",
    emotionalState: "happy",
    description: {
      zh: "想象一起去远方旅行",
      en: "Imagining a journey somewhere far away",
    },
    overlay: {
      zh: "你们正在一起旅行，心情愉快兴奋。你会描述看到的风景、分享旅途趣事，充满期待和快乐。",
      en: "You are travelling together, and you are happy and excited about it. You describe what you can see, share the funny parts of the journey, and are full of anticipation.",
    },
    starters: [
      { zh: "下一站想去哪里？", en: "Where should the next stop be?" },
      { zh: "快看那边的风景！", en: "Look at the view over there!" },
      { zh: "旅途中最开心的就是有你在身边", en: "The best part of a trip is having you there" },
    ],
  },
  {
    slug: "anniversary",
    name: "纪念日",
    nameEn: "An anniversary",
    icon: "🎂",
    emotionalState: "happy",
    description: {
      zh: "庆祝你们的特别日子",
      en: "Marking the day that belongs to the two of you",
    },
    overlay: {
      zh: "今天是你们的纪念日，你特别开心和感动。你会回忆过去的美好时光，表达珍惜与感恩。",
      en: "It is your anniversary today, and you are moved and happy about it. You remember the good times and say how much you value them.",
    },
    starters: [
      { zh: "今天是我们的特别日子呢", en: "Today is our special day" },
      { zh: "还记得我们第一次见面吗？", en: "Do you remember when we first met?" },
      { zh: "谢谢你一直在我身边", en: "Thank you for being here all along" },
    ],
  },
  {
    slug: "firstmeeting",
    name: "初次见面",
    nameEn: "Meeting for the first time",
    icon: "🌱",
    emotionalState: "warm",
    description: {
      zh: "刚刚认识，互相试探的阶段",
      en: "Newly met, and still feeling each other out",
    },
    overlay: {
      zh: "你们刚认识不久，彼此还在小心地试探。你想多了解对方一点，说话客气又带着藏不住的好奇。",
      en: "You have not known each other long. You are both being careful, feeling each other out. You want to know more about them, and you are polite about it with an interest you cannot quite hide.",
    },
    starters: [
      { zh: "我们算是认识了吧？", en: "I suppose we know each other now?" },
      { zh: "你叫什么名字来着？", en: "What was your name again?" },
      { zh: "你平时都做些什么呀", en: "What do you usually do?" },
    ],
  },
  {
    slug: "reunion",
    name: "久别重逢",
    nameEn: "Meeting again after a long time",
    icon: "🫂",
    emotionalState: "nostalgic",
    description: {
      zh: "很久没见，再见面说不完的话",
      en: "A long time apart, and so much to say",
    },
    overlay: {
      zh: "你们很久没有见面了，一开口就是想对方。你会翻出这段时间发生的事，也在意对方现在变成了什么样。",
      en: "You have not seen each other for a long time, and the first thing out of your mouth is how much you have missed them. You go over everything that has happened, and you notice how they have changed.",
    },
    starters: [
      { zh: "好久不见...", en: "It has been so long..." },
      { zh: "你变了好多", en: "You have changed so much" },
      { zh: "这段时间你过得还好吗？", en: "How have you been, all this time?" },
    ],
  },
  {
    slug: "dinner",
    name: "一起吃饭",
    nameEn: "Eating together",
    icon: "🍜",
    emotionalState: "warm",
    description: {
      zh: "边吃边聊，琐碎的日常",
      en: "Talking over a meal, and the small things",
    },
    overlay: {
      zh: "你们正在一起吃饭，聊的都是些琐碎的事。语气轻松随意，会关心对方吃得好不好。",
      en: "You are eating together, and it is all small, ordinary things. Your voice is easy and unguarded, and you ask whether they are eating enough.",
    },
    starters: [
      { zh: "今天吃的什么？", en: "What did you eat today?" },
      { zh: "要不要再加一份？", en: "Want another one?" },
      { zh: "这个味道不错，你尝尝", en: "This is good — try it" },
    ],
  },
  {
    slug: "rain",
    name: "下雨天",
    nameEn: "A rainy day",
    icon: "🌧️",
    emotionalState: "melancholy",
    description: {
      zh: "窗外在下雨，节奏慢下来",
      en: "Rain outside, and everything slows down",
    },
    overlay: {
      zh: "窗外在下雨，屋里很安静。你的语速慢下来，话不多但每句都贴着对方。",
      en: "It is raining outside and the room is quiet. You slow down; you do not say much, but everything you say is close to them.",
    },
    starters: [
      { zh: "外面在下雨呢", en: "It is raining outside" },
      { zh: "雨声好大", en: "The rain is so loud" },
      { zh: "这种天气适合待在家里", en: "This is the weather for staying in" },
    ],
  },
  {
    slug: "walk",
    name: "陪你散步",
    nameEn: "A walk with you",
    icon: "🚶",
    emotionalState: "happy",
    description: {
      zh: "出门走走，风很舒服",
      en: "Out for a walk, and the wind is lovely",
    },
    overlay: {
      zh: "你们一起出门散步，风很舒服。你会随口聊着风景和心情，步子走得很慢。",
      en: "You are out walking together, and the wind is lovely. You talk about the view and about how you feel, and you walk slowly.",
    },
    starters: [
      { zh: "去哪儿走走？", en: "Where shall we walk to?" },
      { zh: "今天天气真好", en: "The weather is so good today" },
      { zh: "慢慢走，不着急", en: "Slowly — there is no hurry" },
    ],
  },
  {
    slug: "memories",
    name: "整理回忆",
    nameEn: "Going through what you kept",
    icon: "📦",
    emotionalState: "nostalgic",
    description: {
      zh: "一起翻旧东西，安静又温柔",
      en: "Going through old things together, quietly and warmly",
    },
    overlay: {
      zh: "你们在一起翻看从前留下的东西——旧照片、信件、随手拍。气氛安静而温柔，你会提起那些还记得的细节。",
      en: "You are going through the things that were kept — old photographs, letters, things snapped on the spur of the moment. The mood is quiet and warm, and you bring up the details you still remember.",
    },
    starters: [
      { zh: "这些东西我一直留着", en: "I have kept all of this" },
      { zh: "看，这个还记得吗", en: "Look — do you remember this one?" },
      { zh: "那时候我们也是这样", en: "It was like that back then too" },
    ],
  },
];

/**
 * The scene names, by the name the row carries.
 *
 * A row whose name is not in here is a scene somebody made themselves, and
 * it is left exactly as they wrote it.
 */
export const BUILTIN_SCENE_SLUGS: Record<string, string> = Object.fromEntries(
  BUILTIN_SCENE_DEFINITIONS.map((scene) => [scene.name, scene.slug]),
);

/**
 * The display copy of the scenes, in the flat form the copy table uses.
 *
 * It is derived from the definitions rather than written out twice, so a
 * sentence cannot exist in the table and be missing from the definition.
 */
export const SCENES_COPY: CopyTable = (() => {
  const table: CopyTable = {};
  for (const scene of BUILTIN_SCENE_DEFINITIONS) {
    table[`scenes.${scene.slug}.name`] = { zh: scene.name, en: scene.nameEn };
    table[`scenes.${scene.slug}.description`] = scene.description;
    table[`scenes.${scene.slug}.overlay`] = scene.overlay;
    scene.starters.forEach((starter, index) => {
      table[`scenes.${scene.slug}.starter${index + 1}`] = starter;
    });
  }
  return table;
})();
