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

import got, { type Got } from "got";
import { config } from "../config.js";
import { enrichCwsError, withCwsErrorContext } from "./errors.js";

const {
  repository,
  cws: { apiRoot, login, timeout, token },
} = config.get("laserfiche");

let authToken: string | undefined = token ?? undefined;
let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const client: Got = got.extend({
  prefixUrl: apiRoot,
  https: {
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
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
    JSON.stringify({ repositoryName: repository, ...login }),
  ).toString("base64");
  const { access_token: accessToken, token_type: type } =
    await withCwsErrorContext(
      client
        .post("api/ConnectionToLaserfiche", {
          headers: { Authorization: `basic ${auth}` },
          form: { grant_type: "password" },
        })
        .json<{
          access_token: string;
          token_type: string;
          expires_in: number;
          api_version: string;
        }>(),
      { endpoint: "api/ConnectionToLaserfiche" },
    );

  authToken = `${type} ${accessToken}`;
  return `${type} ${accessToken}`;
}

/**
 * Authenticated connection to the configured CWS API
 */
export const cws = client.extend({
  hooks: {
    beforeRequest: [
      async (options) => {
        options.headers.Authorization = authToken ?? (await refreshAuthToken());
      },
    ],
    afterResponse: [
      async (response, retryWithMergedOptions) => {
        if (response.statusCode !== 401) return response;

        authToken = await refreshAuthToken();
        return retryWithMergedOptions({
          headers: { Authorization: authToken },
        });
      },
    ],
    beforeError: [(error) => enrichCwsError(error) as typeof error],
  },
});

const refreshAuthToken = async (): Promise<string> => {
  if (!isRefreshing) {
    isRefreshing = true;
    try {
      authToken = await getToken();
      isRefreshing = false;

      for (const { resolve } of refreshQueue) {
        resolve(authToken);
      }

      refreshQueue = [];
      return authToken;
    } catch (error: unknown) {
      isRefreshing = false;
      for (const { reject } of refreshQueue) {
        reject(error);
      }

      refreshQueue = [];
      throw new Error("Failed to refresh auth token", { cause: error });
    }
  }

  return new Promise((resolve, reject) => {
    refreshQueue.push({ resolve, reject });
  });
};

export default cws;
