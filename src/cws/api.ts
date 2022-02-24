/**
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

import config from '../config.js';

import got from 'got';

const {
  repository,
  cws: { apiRoot, login, token },
} = config.get('laserfiche');

const client = got.extend({
  prefixUrl: apiRoot,
});

/**
 * Perform the username/password login with CWS to get a token
 */
async function getToken() {
  const auth = Buffer.from(
    JSON.stringify({ repositoryName: repository, ...login })
  ).toString('base64');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { access_token, token_type } = await client
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

  return `${token_type} ${access_token}`;
}

/**
 * Connection to the configured CWS API
 */
export const cws = client.extend({
  headers: { Authorization: token ?? (await getToken()) },
});

export default cws;
