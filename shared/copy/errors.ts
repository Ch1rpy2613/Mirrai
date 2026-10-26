/**
 * The errors the server reports.
 *
 * These are the sentences a person reads when something has gone wrong,
 * so they are the ones that matter most. They used to be Chinese only,
 * which meant an English user got an English app that answered in
 * Chinese at exactly the moment they needed it to be clear.
 */
import type { CopyTable } from "./index";

export const ERRORS = {
  "errors.personaNotReady": {
    zh: "分身还未准备好，请先完成 AI 解析",
    en: "This persona is not ready yet — finish the analysis first",
  },
  "errors.personaNotReadyShort": {
    zh: "分身还未准备好",
    en: "This persona is not ready yet",
  },
  "errors.personaNotAnalyzed": {
    zh: "这个分身还没有完成解析",
    en: "This persona has not been analyzed yet",
  },
  "errors.personaNotFound": {
    zh: "这个场景不存在，或者不属于你",
    en: "That scene does not exist, or it is not yours",
  },
  "errors.personaNotGraduated": {
    zh: "该分身未毕业",
    en: "This persona has not graduated",
  },
  "errors.noProviderConfigured": {
    zh: "还没有可以用的模型服务：请先在设置里配置一个",
    en: "There is no model service to use yet: configure one in the settings first",
  },
  "errors.collectorFileMismatch": {
    zh: "这个文件不属于所选的分身",
    en: "That file does not belong to the chosen persona",
  },
  "errors.collectorFileMissing": {
    zh: "找不到这个文件",
    en: "That file could not be found",
  },
  "errors.collectorNeedsFile": {
    zh: "这个来源需要一个文件：请先上传要导入的聊天记录或邮件",
    en: "This source needs a file: upload the chat log or the mail export first",
  },
  "errors.personaAlreadyGraduated": {
    zh: "这个分身已经毕业了",
    en: "This persona has already graduated",
  },
  "errors.graduationModeOff": {
    zh: "这个分身的毕业模式已关闭",
    en: "The graduation mode is switched off for this persona",
  },
  "errors.passwordWrong": {
    zh: "密码错误",
    en: "That password is not right",
  },
  "errors.currentPasswordWrong": {
    zh: "当前密码错误",
    en: "The current password is not right",
  },
  "errors.cannotChangePassword": {
    zh: "无法修改密码",
    en: "The password cannot be changed",
  },
  "errors.messageNotFound": {
    zh: "找不到要重新生成的那条消息",
    en: "The message to regenerate could not be found",
  },
  "errors.messageNotEditable": {
    zh: "这条消息改不了",
    en: "This message cannot be edited",
  },
  "errors.correctionNotUnderstood": {
    zh: "没能理解这次修正，请说得更具体一些",
    en: "The correction was not understood — try being more specific",
  },
  "errors.skillNotGenerated": {
    zh: "技能包尚未生成，无法导出",
    en: "The skill pack has not been generated yet, so it cannot be exported",
  },
  "errors.invalidJson": {
    zh: "文件不是有效的 JSON",
    en: "That file is not valid JSON",
  },
  "errors.fileTooLarge": {
    zh: "文件太大",
    en: "That file is too large",
  },
  "errors.unknownTimezone": {
    zh: "无法识别的时区",
    en: "That time zone is not recognised",
  },
  "errors.invalidDateFormat": {
    zh: "日期格式无效，需要 YYYY-MM-DD",
    en: "The date format is wrong — it needs to be YYYY-MM-DD",
  },
  "errors.futureDiary": {
    zh: "不能为未来日期生成日记",
    en: "A diary cannot be written for a date that has not happened",
  },
  "errors.unknownCollector": {
    zh: "未知的采集来源",
    en: "That collection source is not known",
  },
  "errors.noMessagesToExtract": {
    zh: "没有聊天记录可供提取",
    en: "There are no messages to extract from",
  },
  "errors.diaryExists": {
    zh: "该日期已有日记",
    en: "There is already a diary for that date",
  },
  "errors.noMessagesThatDay": {
    zh: "该日期没有聊天记录",
    en: "There are no messages from that day",
  },
  "errors.emptyMessagesThatDay": {
    zh: "该日期的聊天记录内容为空",
    en: "The messages from that day are empty",
  },
  "errors.channelNeedsNoCredentials": {
    zh: "该通道不需要这样配置凭据",
    en: "That channel is not configured this way",
  },
  "errors.noDefaultProvider": {
    zh: "请先配置默认 LLM 提供商",
    en: "Set a default LLM provider first",
  },
  "errors.modelCannotSeeImages": {
    zh: "当前模型 {{provider}} 不支持图片理解，请更换模型或改用文字描述",
    en: "The current model ({{provider}}) cannot look at images — use another model, or describe it instead",
  },
  "errors.authorisationFailed": {
    zh: "授权失败：{{reason}}",
    en: "Authorisation failed: {{reason}}",
  },
  "errors.cardUnreadable": {
    zh: "无法读取角色卡：{{reason}}",
    en: "The character card could not be read: {{reason}}",
  },
  "errors.unknownProvider": {
    zh: "未知的 LLM 提供商：{{provider}}",
    en: "That LLM provider is not known: {{provider}}",
  },
  "errors.fileTypeNotSupported": {
    zh: "不支持的文件类型：{{type}}",
    en: "That file type is not supported: {{type}}",
  },
  "errors.fileMissingExtension": {
    zh: "文件缺少扩展名（{{allowed}}）",
    en: "The file has no extension ({{allowed}})",
  },
  "errors.fileExtensionNotSupported": {
    zh: "不支持的文件扩展名：{{ext}}（允许：{{allowed}}）",
    en: "That file extension is not supported: {{ext}} (allowed: {{allowed}})",
  },
  "errors.skillExportFailed": {
    zh: "技能导出失败",
    en: "The skill could not be exported",
  },
  "errors.rateLimited": {
    zh: "请求过于频繁，请稍后再试",
    en: "Too many requests — please try again in a moment",
  },
  "errors.unsupportedFileType": {
    zh: "不支持的文件类型：{{type}}",
    en: "That file type is not supported: {{type}}",
  },
  "errors.missingExtension": {
    zh: "文件缺少扩展名（{{allowed}}）",
    en: "The file has no extension ({{allowed}})",
  },
  "errors.unsupportedExtension": {
    zh: "不支持的文件扩展名：{{ext}}（允许：{{allowed}}）",
    en: "That file extension is not supported: {{ext}} (allowed: {{allowed}})",
  },
  "errors.usernamePasswordRequired": {
    zh: "用户名和密码不能为空",
    en: "A username and a password are required",
  },
  "errors.registrationFailed": {
    zh: "注册失败",
    en: "Registration failed",
  },
  "errors.loginFailed": {
    zh: "登录失败",
    en: "Sign-in failed",
  },
  "errors.usernameTooShort": {
    zh: "用户名需要 2 到 50 个字符",
    en: "The username must be between 2 and 50 characters",
  },
  "errors.passwordTooShort": {
    zh: "密码至少要 6 个字符",
    en: "The password must be at least 6 characters",
  },
  "errors.usernameTaken": {
    zh: "这个用户名已经被用了",
    en: "That username is already taken",
  },
  "errors.invalidCredentials": {
    zh: "用户名或密码不对",
    en: "That username or password is not right",
  },
  "errors.userNotFound": {
    zh: "找不到这个用户",
    en: "That user could not be found",
  },
  "errors.tooManyAttempts": {
    zh: "尝试次数过多，请稍后再试",
    en: "Too many attempts — please try again in a moment",
  },
  "errors.tooManyRequests": {
    zh: "请求过于频繁",
    en: "Too many requests",
  },

  /** The Feishu channel could not be set up or reached. */
  "errors.feishuSdkMissing": {
    zh: "飞书通道需要 @larksuiteoapi/node-sdk，请先运行 `pnpm install` 安装依赖。",
    en: "The Feishu channel needs @larksuiteoapi/node-sdk — run `pnpm install` to add it.",
  },
  "errors.feishuNoCredentials": {
    zh: "飞书通道尚未配置 App ID / App Secret。",
    en: "The Feishu channel has no App ID / App Secret yet.",
  },
  "errors.feishuNotConnected": {
    zh: "飞书通道尚未连接。",
    en: "The Feishu channel is not connected yet.",
  },
  "errors.feishuNoBinding": {
    zh: "还没有绑定任何飞书会话。",
    en: "No Feishu conversation is bound yet.",
  },

  /** The WeChat channel could not deliver or could not find a conversation. */
  "errors.wechatSendFailed": {
    zh: "微信消息发送失败：机器人未登录或会话已失效。",
    en: "The WeChat message was not sent: the bot is not logged in, or the conversation has expired.",
  },
  "errors.wechatNoBinding": {
    zh: "还没有绑定任何微信会话。",
    en: "No WeChat conversation is bound yet.",
  },

  /** A template file that cannot be used. */
  "errors.templateNotAnObject": {
    zh: "模板必须是一个对象",
    en: "The template has to be an object",
  },
  "errors.templateMissingId": {
    zh: "模板缺少 id",
    en: "The template is missing its id",
  },
  "errors.templateMissingName": {
    zh: "模板缺少 name",
    en: "The template is missing its name",
  },
  "errors.templateMissingPersonaData": {
    zh: "模板缺少 personaData",
    en: "The template is missing its personaData",
  },
  "errors.templateWrongFamily": {
    zh: "模板的 family 必须是 colleague / relationship / celebrity",
    en: "The template's family has to be colleague / relationship / celebrity",
  },

  /** The skill package could not be installed into a host. */
  "errors.skillPackageMissing": {
    zh: "技能包不存在或缺少 SKILL.md：{{path}}",
    en: "The skill package does not exist, or it has no SKILL.md: {{path}}",
  },
  "errors.skillInstallPathMissing": {
    zh: "安装器没有返回安装路径：{{host}}",
    en: "The installer did not report an install path: {{host}}",
  },
} satisfies CopyTable;
