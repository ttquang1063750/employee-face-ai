export type MessageCategory = 'daily_report' | 'weekly_report' | 'monthly_report' | 'other';

// Three distinct shapes rather than one loose interface, because the
// received/sent list endpoints each join only the *other* party's name —
// GET /api/messages/received has no recipient_id/recipient_name (it's
// implicitly "me"), GET /api/messages/sent has no sender_id/sender_name for
// the same reason. Only GET /api/messages/:id (MessageDetail) has both.
export interface ReceivedMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  category: MessageCategory;
  subject: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface SentMessage {
  id: number;
  recipient_id: number;
  recipient_name: string;
  category: MessageCategory;
  subject: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface MessageDetail {
  id: number;
  sender_id: number;
  sender_name: string;
  recipient_id: number;
  recipient_name: string;
  category: MessageCategory;
  subject: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface MessageTemplate {
  id: number;
  category: MessageCategory;
  name: string;
  content: string;
  created_at: string;
}

export interface NewMessagePayload {
  recipient_id: number;
  category: MessageCategory;
  subject: string;
  content: string;
}

export interface NewMessageTemplatePayload {
  category: MessageCategory;
  name: string;
  content: string;
}
