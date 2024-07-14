# 前任 Skills — Todo

## Phase 1: 数据库 Schema
- [x] 设计 personas 表（分身基本信息）
- [x] 设计 persona_files 表（上传文件记录）
- [x] 设计 messages 表（对话历史）
- [x] 推送数据库迁移

## Phase 2: 后端 API
- [x] 文件上传接口（聊天记录 txt/csv、图片、视频）
- [x] AI 解析聊天记录 → 生成 Persona JSON
- [x] AI 分析图片/视频内容 → 补充 Persona 记忆
- [x] Persona CRUD（创建/读取/更新/删除）
- [x] 流式对话接口（携带 Persona 系统 Prompt）
- [x] 情感状态实时计算

## Phase 3: 前端 - 数字分身大厅
- [x] 大厅首页（分身卡片列表）
- [x] 创建新分身入口
- [x] 分身卡片（头像/名字/情感状态/最近对话）
- [x] 无缝切换动画

## Phase 4: 前端 - 文件上传与解析
- [x] 拖拽上传区域（支持 txt/csv/jpg/png/mp4）
- [x] 上传进度显示
- [x] AI 解析进度动画
- [x] 解析结果预览（Persona 卡片）
- [x] 手动补充信息表单

## Phase 5: 前端 - 对话界面
- [x] 流式消息渲染
- [x] 情感状态面板（侧边栏）
- [x] 分身切换按钮（顶部）
- [x] 消息历史持久化
- [x] 情感安全守护提示

## Phase 6: 测试与交付
- [x] 后端 tRPC 路由单元测试（5 tests passed）
- [x] 清理所有 Manus 相关字样
- [x] 写 README.md（含升级对比表）
- [x] 保存检查点
- [x] 推送到 GitHub ex-skills 仓库
