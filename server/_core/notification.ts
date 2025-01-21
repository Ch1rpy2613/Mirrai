export type NotificationPayload = {
  title: string;
  content: string;
};

export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  console.log(`[Notification] ${payload.title}: ${payload.content}`);
  return true;
}
