/**
 * Netlify Function — re-exports the serverless handler from the esbuild-bundled
 * Express app.  The bundle is produced by `artifacts/api-server/build.mjs`
 * during the Netlify build step.
 *
 * Netlify's function bundler follows this import, includes the built bundle,
 * and resolves externalized native modules (bcrypt) from node_modules.
 */
export { handler } from "../../artifacts/api-server/dist/lambda.mjs";
