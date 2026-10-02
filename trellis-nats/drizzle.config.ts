export default {
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/drizzle",
  strict: true,
  verbose: true,
};
