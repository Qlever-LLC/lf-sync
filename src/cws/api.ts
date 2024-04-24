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

/**
 * Creates an authenticated REST connection to CWS
 *
 * @packageDocumentation
 */

import { config } from '../config.js';

import got from 'got';

const {
  repository,
  cws: { apiRoot, login, timeout, token },
} = config.get('laserfiche');

const client = got.extend({
  prefixUrl: apiRoot,
  https: {
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  },
  timeout: {
    request: timeout,
  },
});

/**
 * Perform the username/password login with CWS to get a token
 */
async function getToken() {
  // "Password" is base64 encoded JSON string of login info
  const auth = Buffer.from(
    JSON.stringify({ repositoryName: repository, ...login })
  ).toString('base64');
  const { access_token: accessToken, token_type: type } = await client
    .post('api/ConnectionToLaserfiche', {
      headers: { Authorization: `basic ${auth}` },
      form: { grant_type: 'password' },
    })
    .json<{
      access_token: string;
      token_type: string;
      expires_in: number;
      api_version: string;
    }>();

  return `${type} ${accessToken}`;
}

/**
 * Authenticated connection to the configured CWS API
 */
export const cws = client.extend({
  headers: { Authorization: token ?? (await getToken()) },
});

export default cws;
