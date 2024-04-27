/**
 * @license
 * Copyright 2022 Qlever LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { Metadata } from '../cws/metadata.js';
import type Resource from '@oada/types/oada/resource.js';

const SAP_FIELD = 'sap_id';

export async function ticketMetadata(document: Resource): Promise<Metadata> {

  const doc = document as unknown as TicketArchive;

  return {
    'Entity': doc.org.name,
    'Document Type': 'Zendesk Ticket',
    'Document Date': doc.ticket.created_at,
    'Zendesk Ticket ID': doc.ticket.id.toString(),
    //'Share Mode': 'Shared From Smithfield',
  }
}

export interface Ticket {
  "url": string;
  "id": number;
  "external_id": number | null,
  "via": {
    "channel": number;
    "source": {
      "from": {
        "address": string;
        "name": string;
      },
      "to": {
        "name": string;
        "address": string;
      },
      "rel": string | null;
    }
  },
  "created_at": string;
  "updated_at": string;
  "type": null,
  "subject": string;
  "raw_subject": string;
  "description": string;
  "priority": string;
  "status": string;
  "recipient": string;
  "requester_id": number;
  "submitter_id": number;
  "assignee_id": number;
  "organization_id": number | null;
  "group_id": number;
  "collaborator_ids": any[];
  "follower_ids": any[];
  "email_cc_ids": any[];
  "forum_topic_id": null;
  "problem_id": null;
  "has_incidents": false;
  "is_public": true;
  "due_at": null;
  "tags": any[];
  "custom_fields": Array<{
    "id": number;
    "value": any;
  }>;
  "satisfaction_rating": any;
  "sharing_agreement_ids": any[];
  "custom_status_id": number;
  "fields": Array<{
    "id": number;
    "value": any;
  }>;
  "followup_ids": string[],
  "ticket_form_id": number;
  "brand_id": number;
  "allow_channelback": boolean;
  "allow_attachments": boolean;
  "from_messaging_channel": boolean;
  "result_type": string;
  "organization": {
    "name": string;
  }
}

export interface Attachment {
  "url": string;
  "id": number;
  "file_name": string;
  "content_url": string;
  "mapped_content_url": string;
  "content_type": string;
  "size": number;
  "width": null | string;
  "height": null | string;
  "inline": boolean;
  "deleted": boolean;
  "malware_access_override": boolean;
  "malware_scan_result": string;
  "thumbnails": []
}

export interface TicketArchive {
  ticket: Ticket;
  org: Org;
  comments: Array<Comment>;
  orgs: Record<string | number, Org>;
  groups: Record<string | number, Group>;
  users: Record<string | number, User>;
  fields: Record<string | number, Field>;
  attachments: Record<string | number, Attachment>;
  sideConversations: Array<SideConversationArchive>;
}

//////////
// User //
//////////
export interface User {
  id: number;
  name: string;
  url: string;
  email: string;
  created_at: string;
  updated_at: string;
  time_zone: string;
  iana_time_zone: string;
  phone: null;
  shared_phone_number: null;
  photo: null;
  locale_id: number;
  locale: string;
  organization_id: null | number;
  role: string;
  verified: boolean;
  external_id: null;
  tags: Array<string>;
  alias: null;
  active: boolean;
  shared: boolean;
  shared_agent: boolean;
  last_login_at: string | null;
  two_factor_auth_enabled: null;
  signature: null;
  details: null;
  notes: null;
  role_type: number | null;
  custom_role_id: number | null;
  moderator: boolean;
  ticket_restriction: string | null;
  only_private_comments: boolean;
  restricted_agent: boolean;
  suspended: boolean;
  default_group_id: number | null;
  report_csv: boolean;
  user_fields: {};
}

///////////
// Group //
///////////
export interface Group {
  url: string;
  id: number;
  is_public: boolean;
  name: string;
  description: string;
  default: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Org {
  url: string;
  id: number;
  name: string;
  shared_tickets: boolean;
  shared_comments: boolean;
  external_id: null;
  created_at: string;
  updated_at: string;
  domain_names: Array<string>;
  details: string;
  notes: string;
  group_id: null;
  tags: Array<string>;
  organization_fields: {
    [SAP_FIELD]: string | null;
  };
}

export interface Field {
  url: string;
  id: number;
  type: string;
  title: string;
  raw_title: string;
  description: string;
  raw_description: string;
  position: number;
  active: boolean;
  required: boolean;
  collapsed_for_agents: boolean;
  regexp_for_validation: null;
  title_in_portal: string;
  raw_title_in_portal: string;
  visible_in_portal: boolean;
  editable_in_portal: boolean;
  required_in_portal: boolean;
  tag: null;
  created_at: string;
  updated_at: string;
  removable: boolean;
  key: null;
  agent_description: null | string;
  system_field_options?: Array<{ name: string; value: string }>;
  custom_statuses?: Array<{
    url: string;
    id: number;
    status_category: string;
    agent_label: string;
    end_user_label: string;
    description: string;
    end_user_description: string;
    active: boolean;
    default: boolean;
    created_at: string;
    updated_at: string;
  }>;
  custom_field_options?: Array<{
    id: number;
    name: string;
    raw_name: string;
    value: string;
    default: boolean;
  }>;
  sub_type_id?: number;
  relationship_target_type?: string;
  relationship_filter?: { all: []; any: [] };
}

export interface Comment {
  id: number;
  type: 'Comment';
  author_id: number;
  body: string;
  html_body: string;
  plain_body: string;
  public: boolean;
  attachments: Array<Attachment>;
  audit_id: number;
  via: {
    channel: string;
    source: {
      from:
      | {}
      | {
        address: string;
        name: string | null;
        organization_recipients: Array<string> | null;
      };
      to:
      | {}
      | {
        name: string | null;
        address: string;
        email_ccs: Array<number>;
      };
      rel: null;
    };
  };
  created_at: string;
}

export interface SideConversationArchive {
  sideConversation: SideConversation;
  events: Array<SideConversationEvent>;
  users: Record<string | number, User>;
  attachments: Record<string | number, SideConversationAttachment>;
}

export interface SideConversation {
  url: string;
  id: string;
  ticket_id: number;
  subject: string;
  preview_text: string;
  state: string;
  participants: Array<{
    user_id: number;
    group_id?: number;
    name: string;
    email: string;
  }>;
  created_at: string;
  updated_at: string;
  message_added_at: string;
  state_updated_at: string;
  external_ids:
  | {}
  | {
    targetTicketId: string;
  };
}

export interface SideConversationAttachment {
  id: string;
  file_name: string;
  size: number;
  content_url: string;
  content_type: string;
  width: number;
  height: number;
  inline: boolean;
}

export interface SideConversationEvent {
  id: string;
  side_conversation_id: string;
  actor: {
    user_id: number;
    name: string;
    email: string;
  };
  type: string;
  via: string;
  created_at: string;
  message: {
    subject: string | null;
    preview_text: string;
    from: {
      user_id: number;
      group_id?: number;
      name: string;
      email: string;
    };
    to: Array<{
      user_id: number;
      group_id?: number;
      name: string;
      email: string;
    }>;
    body: string;
    html_body: string;
    external_ids: {
      ticketAuditId: string;
      targetTicketAuditId?: string;
      outboundEmail?: string;
      inboundEmail?: string;
    };
    attachments: Array<SideConversationAttachment>;
  } | null;
  updates: {};
  ticket_id: number;
}