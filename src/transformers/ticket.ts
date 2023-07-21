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
import type { OADAClient } from '@oada/client';
import type Resource from '@oada/types/oada/resource.js';

export async function ticketMetadata(document: Resource, oada: OADAClient): Promise<Metadata> {

  const { data: meta } = await oada.get({
    path: `/${document._id}/_meta/filename`
  })

  return {
    'Entity': document.organization.name,
    'Document Type': 'Zendesk Ticket',
    'Document Date': document.created_at,
    'Zendesk Ticket ID': document.id,
    'Share Mode': 'Shared From Smithfield',
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