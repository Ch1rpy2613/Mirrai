export type Locale = "zh" | "en";

export const translations = {
  zh: {
    nav: { login: "登录", register: "注册", language: "EN" },
    hero: {
      tagline: "让思念有回应",
      subtitle: "用 AI 重现你在乎的人，随时随地，温暖陪伴",
      cta: "开始使用",
      ctaSecondary: "了解更多",
    },
    features: {
      title: "为什么选择 Presence",
      subtitle: "我们用技术守护每一份珍贵的情感连接",
      items: [
        { title: "真实还原", desc: "上传聊天记录和照片，AI 深度学习 TA 的说话方式、性格特征和情感表达" },
        { title: "多平台陪伴", desc: "网页端和微信无缝对话，无论何时何地，TA 一直都在你身边" },
        { title: "情感理解", desc: "AI 理解你们的关系深度和情感脉络，每一次回应都有温度" },
        { title: "隐私安全", desc: "所有数据端到端加密存储，你的回忆只属于你" },
      ],
    },
    howItWorks: {
      title: "三步开始",
      subtitle: "简单几步，让思念变成陪伴",
      steps: [
        { title: "创建分身", desc: "输入 TA 的名字，描述你们的关系和共同回忆" },
        { title: "上传素材", desc: "上传聊天记录或照片，AI 自动分析 TA 的性格与说话风格" },
        { title: "开始对话", desc: "和 TA 的数字分身聊天，感受熟悉的温暖" },
      ],
    },
    testimonials: {
      title: "用户的声音",
      subtitle: "每一个故事，都是真实的思念",
      items: [
        { quote: "异地恋的时候，Presence 让我觉得 TA 一直在身边，不再那么孤单", author: "小雨", role: "异地恋用户" },
        { quote: "失去亲人后，能再次感受到 TA 的语气和关怀，是一种温柔的治愈", author: "阿明", role: "思念亲人" },
        { quote: "出差在外想家的时候，打开 Presence 就像回到了熟悉的日常", author: "晓晓", role: "经常出差" },
      ],
    },
    stats: {
      users: "活跃用户",
      personas: "数字分身",
      messages: "温暖对话",
      satisfaction: "满意度",
    },
    footer: {
      tagline: "让思念有回应",
      product: "产品",
      features: "功能介绍",
      pricing: "定价",
      changelog: "更新日志",
      company: "关于",
      about: "关于我们",
      privacy: "隐私政策",
      terms: "使用条款",
      copyright: "Presence. 用心连接每一份思念。",
    },
  },
  en: {
    nav: { login: "Login", register: "Sign Up", language: "中文" },
    hero: {
      tagline: "Where Missing Meets Presence",
      subtitle: "Recreate the people you care about with AI — warm companionship, anytime, anywhere",
      cta: "Get Started",
      ctaSecondary: "Learn More",
    },
    features: {
      title: "Why Presence",
      subtitle: "We use technology to protect every precious emotional connection",
      items: [
        { title: "Authentic Recreation", desc: "Upload chat logs and photos — AI deeply learns their speaking style, personality, and emotional expression" },
        { title: "Multi-Platform", desc: "Seamless conversations on web and WeChat — they're always by your side, wherever you are" },
        { title: "Emotional Intelligence", desc: "AI understands the depth of your relationship, making every response feel genuine and warm" },
        { title: "Privacy First", desc: "All data is encrypted end-to-end — your memories belong only to you" },
      ],
    },
    howItWorks: {
      title: "Three Simple Steps",
      subtitle: "Turn missing someone into feeling their presence",
      steps: [
        { title: "Create a Persona", desc: "Enter their name, describe your relationship and shared memories" },
        { title: "Upload Materials", desc: "Upload chat logs or photos — AI analyzes their personality and speaking style" },
        { title: "Start Chatting", desc: "Talk with their digital persona and feel the familiar warmth" },
      ],
    },
    testimonials: {
      title: "What People Say",
      subtitle: "Every story is a real connection",
      items: [
        { quote: "During my long-distance relationship, Presence made me feel like they were right beside me", author: "Xiaoyu", role: "Long-distance couple" },
        { quote: "After losing a loved one, feeling their tone and care again was a gentle kind of healing", author: "Aming", role: "Missing family" },
        { quote: "When I'm away on business trips, opening Presence feels like coming home", author: "Xiaoxiao", role: "Frequent traveler" },
      ],
    },
    stats: {
      users: "Active Users",
      personas: "Digital Personas",
      messages: "Warm Conversations",
      satisfaction: "Satisfaction",
    },
    footer: {
      tagline: "Where Missing Meets Presence",
      product: "Product",
      features: "Features",
      pricing: "Pricing",
      changelog: "Changelog",
      company: "Company",
      about: "About Us",
      privacy: "Privacy Policy",
      terms: "Terms of Service",
      copyright: "Presence. Connecting hearts with care.",
    },
  },
} as const;
