/**
 * Abstract Base Connector class for third-party OAuth and API integrations.
 */

export class BaseConnector {
  constructor(integrationId) {
    this.integrationId = integrationId;
  }

  /**
   * Generates authorization URL for OAuth 2.0 flow.
   * @param {object} params
   * @param {string} params.state
   * @param {string} params.redirectUri
   * @param {string[]} [params.scopes]
   * @returns {string}
   */
  getAuthUrl(_params) {
    throw new Error(`getAuthUrl not implemented for ${this.integrationId}`);
  }

  /**
   * Exchanges authorization code for access and refresh tokens.
   * @param {object} params
   * @param {string} params.code
   * @param {string} params.redirectUri
   * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresAt?: Date, accountEmail?: string, accountDisplayName?: string, providerAccountId?: string }>}
   */
  async exchangeCode(_params) {
    throw new Error(`exchangeCode not implemented for ${this.integrationId}`);
  }

  /**
   * Refreshes expired access token using refresh token.
   * @param {string} _refreshToken
   * @returns {Promise<{ accessToken: string, expiresAt?: Date, refreshToken?: string }>}
   */
  async refreshToken(_refreshToken) {
    throw new Error(`refreshToken not implemented for ${this.integrationId}`);
  }

  /**
   * Executes a tool operation using the provided connection credentials.
   * @param {string} toolName
   * @param {object} args
   * @param {object} connection - Decrypted token connection instance
   * @returns {Promise<any>}
   */
  async executeTool(toolName, _args, _connection) {
    throw new Error(`Tool ${toolName} not implemented for ${this.integrationId}`);
  }
}
