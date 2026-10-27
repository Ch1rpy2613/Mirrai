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
  "errors.providerNotConfigured": {
    zh: "还没有配置这个模型服务，先把密钥填上再设为默认",
    en: "This provider is not configured yet — add its key before making it the default",
  },
  "errors.replyFailed": {
    zh: "这次没能说出话来，请再试一次",
    en: "The reply could not be produced this time — please try again",
  },
  "errors.regenerateFailed": {
    zh: "这次没能重新生成回答，原来的回答还在",
    en: "The reply could not be generated this time — the old one is still there",
  },
  /**
   * The turn could not be put back.
   *
   * The old turn was taken away before the new one was asked for — so
   * if it cannot be put back, the user's own words are gone. The app
   * says so rather than claiming the old answer is still there.
   */
  "errors.regenerateRestoreFailed": {
    zh: "这次没能重新生成回答，而且原来那一轮没能放回来——请刷新页面看看",
    en: "The reply could not be generated this time, and the previous turn could not be put back — please refresh to see what is there",
  },
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
  /**
   * There is nothing to distil.
   *
   * A run with no material went through anyway: the model was asked to
   * describe a person it had heard nothing about, it invented one, and
   * the invention replaced the persona the user already had.
   */
  /**
   * A run is already going.
   *
   * The guard was a set in one process's memory — so two instances of
   * the app each started their own run, the user paid twice, and the
   * run that finished last wrote the persona.
   */
  "errors.distillationAlreadyRunning": {
    zh: "这个分身的蒸馏还在进行中，请等它结束。",
    en: "This persona is still being distilled — please wait for the run to finish.",
  },
  "errors.nothingToDistil": {
    zh: "还没有可以分析的材料：请先上传聊天记录，或先收集一些。",
    en: "There is nothing to analyse yet: upload some chat logs, or collect some first.",
  },
  "errors.collectorFileMismatch": {
    zh: "这个文件不属于所选的分身",
    en: "That file does not belong to the chosen persona",
  },
  "errors.collectorFileMissing": {
    zh: "找不到这个文件",
    en: "That file could not be found",
  },
  /**
   * The collector said nothing.
   *
   * The messages the collectors fail with were written in English, in
   * the middle of the code — so a Chinese-first app answered a failure
   * in the wrong language, and the one sentence that explains what
   * went wrong was the one sentence the user could not read.
   */
  /**
   * The job is not running any more.
   *
   * So there was nothing to stop — the collection had already finished,
   * failed, or been stopped.
   */
  /**
   * The browser profile is not a path.
   */
  "errors.collectorChromeProfileInvalid": {
    zh: "浏览器 Profile 的路径不对。",
    en: "That browser profile path is not a path.",
  },
  "errors.collectorNotRunning": {
    zh: "这个采集已经不在运行了。",
    en: "This collection is not running any more.",
  },
  /**
   * The collector process failed.
   *
   * The detail used to be the Python traceback — which says where the
   * tool lives on the operator's machine. It is in the log now.
   */
  "errors.collectorFailed": {
    zh: "采集器「{{source}}」没有跑完（{{reason}}）。",
    en: "The collector \"{{source}}\" did not finish ({{reason}}).",
  },
  /**
   * The collector ran but left nothing to read.
   */
  "errors.collectorNoTranscript": {
    zh: "采集器「{{source}}」没有留下可以读取的内容。",
    en: "The collector \"{{source}}\" left nothing that could be read.",
  },
  "errors.collectorNoOutput": {
    zh: "采集器「{{source}}」没有输出任何内容。",
    en: "The collector \"{{source}}\" produced no output.",
  },
  /**
   * The collector printed more than the cap allows.
   *
   * The advice used to be to "raise the limit" — and the limit is a
   * constant of the program, so there was nothing the user could do.
   * The advice is to collect a smaller range, which is the thing they
   * can actually do.
   */
  "errors.collectorOutputTruncated": {
    zh: "采集器「{{source}}」输出的内容超过了上限，在中途被截断，无法读取。请采集更小的时间范围。开头的内容：{{preview}}",
    en: "The collector \"{{source}}\" printed more than the output limit allows, so it was cut off in the middle and could not be read. Collect a smaller range. The first 200 characters: {{preview}}",
  },
  "errors.collectorOutputUnreadable": {
    zh: "采集器「{{source}}」的输出无法解析成消息。开头的内容：{{preview}}",
    en: "The output of the collector \"{{source}}\" could not be parsed into messages. The first 200 characters: {{preview}}",
  },
  "errors.collectorNeedsFile": {
    zh: "这个来源需要一个文件：请先上传要导入的聊天记录或邮件",
    en: "This source needs a file: upload the chat log or the mail export first",
  },
  "errors.collectorNeedsTarget": {
    zh: "这个来源需要一个名字：请填写要保留谁的记录",
    en: "This source needs a name: say whose messages you want to keep",
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
  /**
   * The export failed.
   *
   * It does not say why: the reason is in the server's log, and it
   * carries the server's own paths — which do not belong in a browser.
   * So it says what the user can do instead.
   */
  "errors.skillExportFailed": {
    zh: "技能导出失败。请确认这台机器上装有 Python 3，然后重试；详细原因请看服务端日志。",
    en: "The skill could not be exported. Make sure Python 3 is installed on this machine and try again — the reason is in the server's log.",
  },
  /**
   * The errors that have no message of their own.
   *
   * A procedure that throws `new TRPCError({ code: "NOT_FOUND" })`
   * without a message gets the *code* as its message — so the
   * interface showed the token "NOT_FOUND" under a heading that said
   * "not found". The code is for the machine; this is for the person.
   */
  /**
   * The app's own input validation said no.
   *
   * It used to be "something went wrong on the server" — which blames
   * the server for something the user typed, and was in English in a
   * Chinese-first app.
   */
  "errors.invalidInput": {
    zh: "这一项填得不对，请检查一下。",
    en: "That does not look right — please check it.",
  },
  "errors.code.notFound": {
    zh: "没有找到要找的东西。",
    en: "That could not be found.",
  },
  "errors.code.badRequest": {
    zh: "这个请求没法处理。",
    en: "That request could not be handled.",
  },
  /**
   * The chat stream's own errors.
   *
   * The stream answered with an English string, and the interface
   * showed it inside its own message: "generation failed: Streaming
   * request failed with status 429". So the one error the user was
   * most likely to hit — they typed too fast — was the one they could
   * read least.
   */
  /**
   * The streaming request failed before it began.
   *
   * The server used to let the failure out of the route handler — and
   * Express 4 does not wait for the promise an async handler returns,
   * so the whole app went down.
   */
  "errors.streamServerError": {
    zh: "这次没能连上服务器，请再试一次。",
    en: "The server could not be reached — please try again.",
  },
  "errors.streamUnauthorized": {
    zh: "请先登录。",
    en: "Please sign in first.",
  },
  "errors.streamTooManyRequests": {
    zh: "你说得太快了——等一下再试。",
    en: "You are sending too fast — wait a moment and try again.",
  },
  /** The message was longer than the app accepts. */
  "errors.streamMessageTooLong": {
    zh: "这条消息太长了——最多两千字。",
    en: "That message is too long — two thousand characters at the most.",
  },
  /** The stream ended before the reply was finished. */
  "errors.streamEndedEarly": {
    zh: "连接中断了，这段回答没有说完。",
    en: "The connection ended before the reply was finished.",
  },
  "errors.streamInvalidRequest": {
    zh: "这个请求不完整。",
    en: "That request was not complete.",
  },
  "errors.streamNoBody": {
    zh: "服务器没有返回内容。",
    en: "The server sent nothing back.",
  },
  "errors.code.unauthorized": {
    zh: "请先登录。",
    en: "Please sign in first.",
  },
  "errors.code.forbidden": {
    zh: "没有权限做这件事。",
    en: "You are not allowed to do that.",
  },
  "errors.code.conflict": {
    zh: "已经有一份了。",
    en: "There is already one of those.",
  },
  "errors.code.preconditionFailed": {
    zh: "还差一步才能做这件事。",
    en: "Something is missing before that can be done.",
  },
  "errors.code.payloadTooLarge": {
    zh: "东西太大了。",
    en: "That is too large.",
  },
  "errors.code.tooManyRequests": {
    zh: "请求太频繁了，请稍后再试。",
    en: "Too many requests — please try again in a moment.",
  },
  "errors.code.internal": {
    zh: "出了点问题。",
    en: "Something went wrong.",
  },
  "errors.code.timeout": {
    zh: "等得太久了。",
    en: "That took too long.",
  },
  "errors.code.unknown": {
    zh: "出了点问题。",
    en: "Something went wrong.",
  },
  "errors.evalAlreadyRunning": {
    zh: "这次评测还在跑，请等它跑完。",
    en: "This evaluation is still running — wait for it to finish.",
  },
  "errors.rateLimited": {
    zh: "请求过于频繁，请稍后再试",
    en: "Too many requests — please try again in a moment",
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
  /** Feishu refused to deliver a message. */
  "errors.feishuSendFailed": {
    zh: "飞书没有送达这条消息：{{message}}",
    en: "Feishu did not deliver this message: {{message}}",
  },
  /** The App ID does not look like a Feishu App ID, so nothing can connect. */
  "errors.feishuInvalidAppId": {
    zh: "这个 App ID 不像是飞书的 App ID（应以 cli_ 开头，后面是十六位十六进制字符），通道没有连接。",
    en: "That App ID does not look like a Feishu App ID (it should start with cli_ and be followed by sixteen hexadecimal characters), so the channel did not connect.",
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
  /**
   * A source that needs credentials, and has none.
   *
   * The machine's own configuration file is deliberately not a source:
   * it holds the credentials of whoever set the collector up on this
   * machine, and a collection that used them imported the operator's
   * own history into the user's persona.
   */
  /**
   * The browser profile a collector needs.
   *
   * The DingTalk collector reads the chat history by driving a browser,
   * and the browser's login *is* the credential. So the profile has to
   * be named, and it has to be the user's own — the collector used to
   * fall back to the machine's Chrome, which is the operator's.
   */
  "errors.collectorNeedsChromeProfile": {
    zh: "钉钉的消息记录是通过浏览器采集的，需要你指定自己的 Chrome Profile 路径。浏览器的登录状态就是凭据，所以它必须是你自己的。",
    en: "DingTalk's message history is read through a browser, and the browser's login is the credential — so it has to be your own Chrome profile, named explicitly.",
  },
  /**
   * The day already has a diary.
   *
   * The day is unique in the database now, so two generations that
   * passed the check together cannot both write — and the second one
   * is told what happened instead of a database error.
   */
  "errors.diaryAlreadyExists": {
    zh: "这一天已经有日记了。",
    en: "This day already has a diary.",
  },
  /**
   * The credentials could not be stored.
   *
   * The failure was swallowed and the procedure reported success — so
   * the user saw "authorised" and the next collection had no
   * credentials at all, with no idea why.
   */
  "errors.collectorCredentialsNotSaved": {
    zh: "凭据没有存下来，所以这次授权不算数。请再试一次。",
    en: "The credentials could not be stored, so this authorisation did not take. Please try again.",
  },
  /**
   * The interpreter is not there.
   *
   * The collectors are Python scripts. The desktop builds ship the
   * scripts but no interpreter, so the spawn failed with
   * "spawn python3 ENOENT" — which says nothing about what to do about
   * it.
   */
  "errors.collectorNeedsPython": {
    zh: "采集器没能启动：这台机器上找不到 {{path}}。采集来源需要 Python 3——装一个，或者把 PYTHON_PATH 指向你要用的解释器。（工具：{{tool}}）",
    en: "The collector could not be started: {{path}} was not found on this machine. The collection sources need Python 3 — install it, or point PYTHON_PATH at the interpreter you want to use. (tool: {{tool}})",
  },
  "errors.collectorNeedsAuthorization": {
    zh: "这个来源还没有授权。填好凭据并点「授权」，再开始采集。",
    en: "This source has not been authorised yet. Fill in the credentials and press Authorise, then start the collection.",
  },
  "errors.wechatNoBinding": {
    zh: "还没有绑定任何微信会话。",
    en: "No WeChat conversation is bound yet.",
  },
  /**
   * The WeChat login has expired.
   *
   * The notice was hard-coded Chinese — so an English user was told, in
   * Chinese, to scan the code again.
   */
  "errors.wechatTokenExpired": {
    zh: "微信登录已过期，请重新扫码连接。",
    en: "The WeChat login has expired. Please scan the code again to reconnect.",
  },
  /** The QR code expired before the scan came back. */
  "errors.wechatQrExpired": {
    zh: "二维码已过期，请重新发起连接。",
    en: "The QR code has expired. Please start the connection again.",
  },
  /** The backend confirmed the login but sent no credentials. */
  "errors.wechatNoCredentials": {
    zh: "登录失败：服务器未返回凭据。",
    en: "The sign-in failed: the server returned no credentials.",
  },
  /** The stored WeChat credentials could not be decrypted. */
  "errors.wechatCredentialsLost": {
    zh: "凭据已失效，请重新连接微信",
    en: "The stored credentials are no longer valid. Please connect WeChat again.",
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
    zh: "技能包不存在或缺少 SKILL.md",
    en: "The skill package does not exist, or it has no SKILL.md",
  },
  "errors.skillInstallPathMissing": {
    zh: "安装器没有返回安装路径：{{host}}",
    en: "The installer did not report an install path: {{host}}",
  },
} satisfies CopyTable;
