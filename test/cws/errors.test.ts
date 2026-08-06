/**
 * @license
 * Copyright 2026 Qlever LLC
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

import test from "ava";

import { enrichCwsError, getCwsErrorDetails } from "../../dist/cws/errors.js";

interface TestHttpError extends Error {
  options: { method: string };
  response: {
    body?: unknown;
    rawBody?: Uint8Array;
    statusCode: number;
    statusMessage: string;
    url: string;
  };
}

interface TestRequestError extends Error {
  code: string;
  options: { method: string; url: string };
}

function httpError({
  body,
  rawBody,
  statusCode = 400,
  statusMessage = "Bad Request",
}: {
  body?: unknown;
  rawBody?: Uint8Array;
  statusCode?: number;
  statusMessage?: string;
}): TestHttpError {
  const error = new Error(
    `Response code ${statusCode} (${statusMessage})`,
  ) as TestHttpError;
  error.options = { method: "POST" };
  error.response = {
    body,
    rawBody,
    statusCode,
    statusMessage,
    url: "http://localhost/CWSAPI/api/CreateDocument",
  };
  return error;
}

test("enriches CWS validation errors with response details", (t) => {
  const error = enrichCwsError(
    httpError({
      body: {
        ExceptionMessage: "The Document Date field is invalid.",
        Message: "An error has occurred.",
        StackTrace: "server stack",
      },
    }),
    {
      endpoint: "api/CreateDocument",
      request: {
        LaserficheDocumentName: "invoice.pdf",
        LaserficheFieldNames: ["Document Date"],
      },
    },
  );

  const details = getCwsErrorDetails(error);

  t.is(
    error.message,
    "api/CreateDocument failed with 400 Bad Request: The Document Date field is invalid.",
  );
  t.like(details, {
    endpoint: "api/CreateDocument",
    failureClass: "validation",
    method: "POST",
    reason: "The Document Date field is invalid.",
    retryable: false,
    statusCode: 400,
  });
  t.deepEqual(details?.request?.LaserficheFieldNames, ["Document Date"]);
  t.false(details?.responseBody?.includes("server stack"));
});

test("classifies CWS not found errors from raw response bodies", (t) => {
  const details = getCwsErrorDetails(
    httpError({
      rawBody: Buffer.from(
        JSON.stringify({
          Message: "Entry not found.",
          StackTrace: "server stack",
        }),
      ),
      statusCode: 404,
      statusMessage: "Not Found",
    }),
  );

  t.like(details, {
    endpoint: "api/CreateDocument",
    failureClass: "not-found",
    reason: "Entry not found.",
    retryable: false,
    statusCode: 404,
  });
  t.false(details?.responseBody?.includes("server stack"));
});

test("classifies response-less CWS timeout errors", (t) => {
  const error = new Error("Timeout awaiting CWS response") as TestRequestError;
  error.code = "ETIMEDOUT";
  error.options = {
    method: "PUT",
    url: "http://localhost/CWSAPI/api/Document/123/pdf",
  };

  t.like(getCwsErrorDetails(error), {
    endpoint: "api/Document/123/pdf",
    failureClass: "timeout",
    method: "PUT",
    reason: "Timeout awaiting CWS response",
    retryable: true,
  });
});
