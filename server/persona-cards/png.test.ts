import { describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import { existsSync } from "fs";

import {
  crc32,
  defaultIconCandidates,
  readPngChunks,
  readPngTextChunks,
  resolveDefaultIconPath,
  writePngWithTextChunk,
} from "./png";
import {
  type CharacterCardV2,
  deserializeCard,
  readCardFromPng,
  serializeCard,
  writeCardToPng,
} from "./card";
import { cardToPersonaData, personaDataToCard, resolveCardOpeningLines } from "./mapping";
import type { PersonaData } from "../_core/persona-schema";
import { computeEmotionalState } from "../_core/persona-utils";
import {
  EMOTION_TRIGGER_PATTERNS,
  EMOTION_TRIGGER_WORDS,
  matchEmotionTrigger,
} from "@shared/emotion-triggers";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Builds a PNG chunk with a correct CRC, mirroring the writer in `png.ts`. */
function makeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, checksum]);
}

/** Builds a `tEXt` chunk payload: keyword, NUL, text. */
function textChunkData(key: string, text: string): Buffer {
  return Buffer.concat([Buffer.from(key, "latin1"), Buffer.from([0]), Buffer.from(text, "utf8")]);
}

/** Builds a minimal but valid 2x2 RGB PNG. */
function buildPng(width = 2, height = 2): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter byte plus three bytes per pixel for every scanline.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * (1 + width * 3) + 1 + x * 3;
      raw[pixel] = (x * 40) & 0xff;
      raw[pixel + 1] = (y * 60) & 0xff;
      raw[pixel + 2] = 0x80;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Returns the raw bytes of the first chunk with the given type. */
function rawChunkBytes(png: Buffer, type: string): Buffer {
  const chunks = readPngChunks(png);
  const index = chunks.findIndex((chunk) => chunk.type === type);
  expect(index).toBeGreaterThanOrEqual(0);
  return chunks[index].data;
}

const samplePersona: PersonaData = {
  personality: "温柔但有边界",
  speakingStyle: "短句，喜欢用语气词",
  catchphrases: ["嗯嗯", "好呀"],
  nickname: "宝贝",
  memories: "第一次一起看海",
  attachmentStyle: "安全型",
  loveLanguage: "精心时刻",
  conflictStyle: "先冷静再和好",
  touchingMoments: "记得我说过的小细节",
  summary: "温暖、真诚的人",
};

const sampleCard: CharacterCardV2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "小A",
    description: "性格：温柔但有边界\n依恋类型：安全型",
    personality: "温柔但有边界",
    scenario: "前女友（2020-01 至 2022-06）",
    first_mes: "今天过得怎么样？",
    mes_example: "说话方式：短句，喜欢用语气词",
    creator_notes: "由 Mirrai 生成的 AI 模拟角色",
    system_prompt: "你是小A。",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: ["AI模拟"],
    creator: "Mirrai",
    character_version: "1.0",
    extensions: {},
  },
};

describe("crc32", () => {
  it("matches the known CRC-32 of \"123456789\"", () => {
    expect(crc32(Buffer.from("123456789", "latin1"))).toBe(0xcbf43926);
  });

  it("returns 0 for an empty buffer", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe("readPngChunks", () => {
  it("returns the chunk types in file order", () => {
    const png = buildPng();
    const types = readPngChunks(png).map((chunk) => chunk.type);
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("throws for input that is not a PNG", () => {
    expect(() => readPngChunks(Buffer.from("not a png at all"))).toThrow(/Not a PNG/);
  });

  it("throws for a PNG without IHDR or IEND", () => {
    const truncated = Buffer.concat([PNG_SIGNATURE, makeChunk("IHDR", Buffer.alloc(13))]);
    expect(() => readPngChunks(truncated)).toThrow(/missing IEND/);

    const noHeader = Buffer.concat([PNG_SIGNATURE, makeChunk("IEND", Buffer.alloc(0))]);
    expect(() => readPngChunks(noHeader)).toThrow(/missing IHDR/);
  });
});

describe("writePngWithTextChunk", () => {
  it("round-trips the text chunk", () => {
    const png = buildPng();
    const written = writePngWithTextChunk(png, "chara", "hello 世界");

    const texts = readPngTextChunks(written);
    expect(texts).toEqual([{ key: "chara", text: "hello 世界" }]);
  });

  it("keeps the image data byte-for-byte identical", () => {
    const png = buildPng();
    const written = writePngWithTextChunk(png, "chara", "payload");

    expect(rawChunkBytes(written, "IDAT").equals(rawChunkBytes(png, "IDAT"))).toBe(true);

    const originalTypes = readPngChunks(png).map((chunk) => chunk.type);
    const writtenTypes = readPngChunks(written).map((chunk) => chunk.type);
    expect(writtenTypes).toEqual([...originalTypes.slice(0, -1), "tEXt", "IEND"]);
  });

  it("replaces a chunk that uses the same keyword", () => {
    const png = writePngWithTextChunk(buildPng(), "chara", "first");
    const written = writePngWithTextChunk(png, "chara", "second");

    const texts = readPngTextChunks(written);
    expect(texts).toEqual([{ key: "chara", text: "second" }]);
  });

  it("reads compressed and internationalised text chunks", () => {
    const zlibData = deflateSync(Buffer.from("compressed", "utf8"));
    const ztxt = Buffer.concat([
      Buffer.from("key", "latin1"),
      Buffer.from([0]),
      Buffer.from([0]),
      zlibData,
    ]);

    const itxt = Buffer.concat([
      Buffer.from("note", "latin1"),
      Buffer.from([0]),
      Buffer.from([0, 0]),
      Buffer.from("zh", "latin1"),
      Buffer.from([0]),
      Buffer.from("note", "utf8"),
      Buffer.from([0]),
      Buffer.from("国际文本", "utf8"),
    ]);

    const png = Buffer.concat([
      PNG_SIGNATURE,
      makeChunk("IHDR", Buffer.alloc(13)),
      makeChunk("zTXt", ztxt),
      makeChunk("iTXt", itxt),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);

    expect(readPngTextChunks(png)).toEqual([
      { key: "key", text: "compressed" },
      { key: "note", text: "国际文本" },
    ]);
  });
});

describe("readCardFromPng", () => {
  it("reads a V2 card from the `chara` chunk", () => {
    const png = writeCardToPng(buildPng(), sampleCard);
    const card = readCardFromPng(png);

    expect(card.spec).toBe("chara_card_v2");
    expect(card.spec_version).toBe("2.0");
    expect(card.data.name).toBe("小A");
    expect(card.data.first_mes).toBe("今天过得怎么样？");
  });

  it("maps a legacy V1 card from the `base64` chunk", () => {
    const legacy = {
      char_name: "小B",
      description: "很安静",
      char_personality: "慢热",
      scenario: "大学同学",
      char_greeting: "好久不见",
      mes_example: "说话很慢",
      creator_notes: "手写卡片",
    };
    const png = Buffer.concat([
      PNG_SIGNATURE,
      makeChunk("IHDR", Buffer.alloc(13)),
      makeChunk("IDAT", deflateSync(Buffer.alloc(9))),
      makeChunk("tEXt", textChunkData("base64", JSON.stringify(legacy))),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);

    const card = readCardFromPng(png);
    expect(card.spec).toBe("chara_card_v2");
    expect(card.data.name).toBe("小B");
    expect(card.data.personality).toBe("慢热");
    expect(card.data.scenario).toBe("大学同学");
    expect(card.data.first_mes).toBe("好久不见");
    expect(card.data.mes_example).toBe("说话很慢");
    expect(card.data.creator_notes).toBe("手写卡片");
  });

  it("throws when the PNG carries no card", () => {
    expect(() => readCardFromPng(buildPng())).toThrow(/does not contain a character card/);
  });

  it("throws for a payload that is not a character card", () => {
    const png = writePngWithTextChunk(buildPng(), "chara", serializeCard({
      ...sampleCard,
      spec: "chara_card_v1" as unknown as "chara_card_v2",
    }));
    expect(() => readCardFromPng(png)).toThrow(/Unsupported character card spec/);
  });
});

describe("serializeCard / deserializeCard", () => {
  it("round-trips a card through base64", () => {
    const payload = serializeCard(sampleCard);
    expect(Buffer.from(payload, "base64").toString("utf8")).toContain("chara_card_v2");

    const parsed = deserializeCard(payload);
    expect(parsed.data.name).toBe("小A");
  });

  it("rejects a payload that is not base64 JSON", () => {
    expect(() => deserializeCard("not-base64-json")).toThrow(/not valid JSON/);
  });
});

describe("persona mapping", () => {
  it("exports a persona into a card", () => {
    const card = personaDataToCard({
      name: "小A",
      relationshipDesc: "前女友",
      togetherFrom: "2020-01",
      togetherTo: "2022-06",
      personaData: samplePersona,
      systemPrompt: "你是小A。",
      firstMessage: "今天过得怎么样？",
      intimacyLevel: "intimate",
      memories: [
        { content: "第一次一起看海", anchor: true },
        { content: "她喜欢草莓蛋糕", keys: ["蛋糕"] },
      ],
    });

    expect(card.spec).toBe("chara_card_v2");
    expect(card.data.name).toBe("小A");
    expect(card.data.description).toContain("温柔但有边界");
    expect(card.data.description).toContain("安全型");
    expect(card.data.scenario).toContain("前女友");
    expect(card.data.scenario).toContain("2020-01 至 2022-06");
    expect(card.data.system_prompt).toBe("你是小A。");
    expect(card.data.first_mes).toBe("今天过得怎么样？");
    expect(card.data.mes_example).toContain("常用语气词：嗯嗯、好呀");
    expect(card.data.creator_notes).toContain("AI");
    expect(card.data.tags).toContain("前女友");
    expect(card.data.tags).toContain("intimate");

    const entries = card.data.character_book?.entries ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0].constant).toBe(true);
    expect(entries[1].constant).toBe(false);
    expect(entries[1].keys).toEqual(["蛋糕"]);
  });

  it("round-trips the key persona fields", () => {
    const card = personaDataToCard({
      name: "小A",
      relationshipDesc: "前女友",
      togetherFrom: "2020-01",
      togetherTo: "2022-06",
      personaData: samplePersona,
      firstMessage: "今天过得怎么样？",
    });

    const restored = cardToPersonaData(card);
    expect(restored.personality).toBe(samplePersona.personality);
    expect(restored.speakingStyle).toBe(samplePersona.speakingStyle);
    expect(restored.catchphrases).toEqual(samplePersona.catchphrases);
    expect(restored.nickname).toBe(samplePersona.nickname);
    expect(restored.attachmentStyle).toBe(samplePersona.attachmentStyle);
    expect(restored.loveLanguage).toBe(samplePersona.loveLanguage);
    expect(restored.conflictStyle).toBe(samplePersona.conflictStyle);
    expect(restored.touchingMoments).toBe(samplePersona.touchingMoments);
    expect(restored.summary).toBe(samplePersona.summary);
    expect(restored.memories).toBe(samplePersona.memories);
  });

  it("recovers the persona from a card that carries no Mirrai extension", () => {
    const card: CharacterCardV2 = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        ...sampleCard.data,
        personality: "",
        description: "性格：慢热\n依恋类型：回避型\n爱的语言：服务\n争吵方式：冷战",
        mes_example: "说话方式：慢条斯理\n常用语气词：嗯、好\n称呼对方：同学",
      },
    };

    const restored = cardToPersonaData(card);
    expect(restored.personality).toBe("慢热");
    expect(restored.attachmentStyle).toBe("回避型");
    expect(restored.loveLanguage).toBe("服务");
    expect(restored.conflictStyle).toBe("冷战");
    expect(restored.speakingStyle).toBe("慢条斯理");
    expect(restored.catchphrases).toEqual(["嗯", "好"]);
    expect(restored.nickname).toBe("同学");
  });

  it("survives a full PNG round trip", () => {
    const card = personaDataToCard({
      name: "小A",
      personaData: samplePersona,
      firstMessage: "今天过得怎么样？",
    });

    const png = writeCardToPng(buildPng(), card);
    const restored = cardToPersonaData(readCardFromPng(png));
    expect(restored.personality).toBe(samplePersona.personality);
    expect(restored.nickname).toBe(samplePersona.nickname);
  });
});

describe("the opening lines of a card", () => {
  it("takes the first scene starter as the first message", () => {
    const lines = resolveCardOpeningLines({
      sceneStarters: ["睡不着吗？", "夜深了，在想什么呢...", "这个时间特别想你"],
    });

    expect(lines.firstMessage).toBe("睡不着吗？");
    expect(lines.alternateGreetings).toEqual(["夜深了，在想什么呢...", "这个时间特别想你"]);
  });

  it("falls back to the caller's lines when there are no starters", () => {
    const lines = resolveCardOpeningLines({
      firstMessage: "……小A在吗？",
      alternateGreetings: ["嗨", ""],
    });

    expect(lines.firstMessage).toBe("……小A在吗？");
    expect(lines.alternateGreetings).toEqual(["嗨"]);
  });

  it("ignores starters that are only whitespace", () => {
    const lines = resolveCardOpeningLines({
      sceneStarters: ["", "   "],
      firstMessage: "……小A在吗？",
    });

    expect(lines.firstMessage).toBe("……小A在吗？");
    expect(lines.alternateGreetings).toEqual([]);
  });

  it("writes the scene starters into the card", () => {
    const card = personaDataToCard({
      name: "小A",
      personaData: samplePersona,
      firstMessage: "……小A在吗？",
      sceneStarters: ["今天过得怎么样？", "在忙吗？", "睡了吗？"],
    });

    expect(card.data.first_mes).toBe("今天过得怎么样？");
    expect(card.data.alternate_greetings).toEqual(["在忙吗？", "睡了吗？"]);
  });

  it("keeps the caller's first message when the persona has no scene", () => {
    const card = personaDataToCard({
      name: "小A",
      personaData: samplePersona,
      firstMessage: "……小A在吗？",
    });

    expect(card.data.first_mes).toBe("……小A在吗？");
    expect(card.data.alternate_greetings).toEqual([]);
  });
});

describe("the default icon", () => {
  it("is found in the repository", () => {
    const iconPath = resolveDefaultIconPath();
    expect(iconPath).not.toBeNull();
    expect(iconPath?.endsWith("icon-512.png")).toBe(true);
    expect(existsSync(iconPath as string)).toBe(true);
  });

  it("is looked for in the working directory as well", () => {
    const candidates = defaultIconCandidates({ moduleDir: "/nowhere", cwd: "/somewhere" });
    expect(candidates).toContain("/somewhere/client/public/icons/icon-512.png");
  });

  it("is looked for in the packaged layout as well", () => {
    const candidates = defaultIconCandidates({ moduleDir: "/nowhere", cwd: "/somewhere" });
    expect(candidates).toContain("/nowhere/public/icons/icon-512.png");
    expect(candidates).toContain("/somewhere/dist/public/icons/icon-512.png");
  });

  it("is null when it is nowhere to be found", () => {
    expect(resolveDefaultIconPath({ moduleDir: "/nowhere", cwd: "/somewhere" })).toBeNull();
  });
});

describe("the shared emotion trigger tables", () => {
  const samples: Array<["zh" | "en", string]> = [
    ["zh", "我想你了"],
    ["zh", "哈哈哈太好笑了"],
    ["zh", "我好难过"],
    ["zh", "今天好开心"],
    ["zh", "随便吧"],
    ["zh", "今天天气不错"],
    ["en", "I miss you"],
    ["en", "haha that's funny"],
    ["en", "I'm so sad"],
    ["en", "I'm so happy today"],
    ["en", "whatever"],
    ["en", "the weather is nice today"],
  ];

  it("decide the same state as the heuristic the server still uses", () => {
    for (const [locale, text] of samples) {
      const shared = matchEmotionTrigger(text, locale) ?? "warm";
      const server = computeEmotionalState(text, "", "warm", locale);
      expect(shared).toBe(server);
    }
  });

  it("lists the words the patterns match", () => {
    expect(EMOTION_TRIGGER_WORDS.zh).toContain("想你");
    expect(EMOTION_TRIGGER_WORDS.en).toContain("i miss you");
    expect(EMOTION_TRIGGER_WORDS.en).toContain("that's funny");
    expect(EMOTION_TRIGGER_WORDS.en).toContain("thats funny");
  });

  it("matches the words it lists", () => {
    for (const word of EMOTION_TRIGGER_WORDS.zh) {
      expect(Object.values(EMOTION_TRIGGER_PATTERNS.zh).some((p) => p.test(word))).toBe(true);
    }
    for (const word of EMOTION_TRIGGER_WORDS.en) {
      expect(Object.values(EMOTION_TRIGGER_PATTERNS.en).some((p) => p.test(word))).toBe(true);
    }
  });
});
