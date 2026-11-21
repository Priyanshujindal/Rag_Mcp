import { GoogleConnector } from "./google.connector.js";
import { GitHubConnector } from "./github.connector.js";
import { NotionConnector } from "./notion.connector.js";
import { SlackConnector } from "./slack.connector.js";
import { LinearConnector } from "./linear.connector.js";

const connectors = {
  gmail: new GoogleConnector("gmail"),
  google_drive: new GoogleConnector("google_drive"),
  google_calendar: new GoogleConnector("google_calendar"),
  github: new GitHubConnector(),
  notion: new NotionConnector(),
  slack: new SlackConnector(),
  linear: new LinearConnector(),
};

/**
 * Returns connector instance by integration ID.
 * @param {string} integrationId
 */
export function getConnector(integrationId) {
  const conn = connectors[integrationId];
  if (!conn) {
    throw new Error(`No connector implementation found for integration: ${integrationId}`);
  }
  return conn;
}
