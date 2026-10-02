FROM denoland/deno:2.7.14

WORKDIR /app

COPY deno.json deno.lock ./
COPY . .
RUN deno cache --frozen main.ts
RUN deno task check

ENV PORT=8080
EXPOSE 8080

USER deno

CMD ["task", "start"]
