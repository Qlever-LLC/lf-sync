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

import got, { type Got, RetryError } from "got";
import { config } from "../config.js";

const {
  repository,
  cws: { apiRoot, login, timeout, token },
} = config.get("laserfiche");

let authToken = token ?? "";
let isRefreshing = false;
let refreshQueue: ((t: string) => void)[] = [];

const client: Got = got.extend({
  prefixUrl: apiRoot,
  https: {
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
  },
  /*
  timeout: {
    request: timeout,
  },
  */
});

/**
 * Perform the username/password login with CWS to get a token
 */
async function getToken() {
  // "Password" is base64 encoded JSON string of login info
  const auth = Buffer.from(
    JSON.stringify({ repositoryName: repository, ...login }),
  ).toString("base64");
  const { access_token: accessToken, token_type: type } = await client
    .post("api/ConnectionToLaserfiche", {
      headers: { Authorization: `basic ${auth}` },
      form: { grant_type: "password" },
    })
    .json<{
      access_token: string;
      token_type: string;
      expires_in: number;
      api_version: string;
    }>();

  authToken = `${type} ${accessToken}`;
  return `${type} ${accessToken}`;
}

/**
 * Authenticated connection to the configured CWS API
 */
export const cws = client.extend({
  headers: { Authorization: authToken ?? (await getToken()) },
  hooks: {
    beforeRequest: [
      (options) => {
        options.headers.Authorization = authToken;
      },
    ],
    beforeError: [
      async (error) => {
        const { request, response } = error;
        if (response?.statusCode === 401) {
          authToken = await refreshAuthToken();
          request!.options.headers.Authorization = `Bearer ${authToken}`;
          // Retry the original request with the new token
          return new RetryError(request!);
        }

        return error;
      },
    ],
  },
});

const refreshAuthToken = async (): Promise<string> => {
  if (!isRefreshing) {
    isRefreshing = true;
    try {
      // Replace this with your actual token refresh logic.
      authToken = await getToken(); // Update your auth token
      isRefreshing = false;

      // Resolve all the pending requests in the queue with the new token
      refreshQueue.forEach((callback) => callback(authToken));
      refreshQueue = [];
    } catch (error: unknown) {
      isRefreshing = false;
      throw new Error("Failed to refresh auth token", { cause: error });
    }
  }

  // Return a promise that resolves with the new token
  return new Promise((resolve) => refreshQueue.push(resolve));
};

export default cws;
