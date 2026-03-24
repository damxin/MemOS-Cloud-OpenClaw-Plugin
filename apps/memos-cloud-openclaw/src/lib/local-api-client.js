/**
 * Local MemOS API Client
 * 
 * Connects the Cloud Plugin to a local MemOS instance
 * for hybrid local/cloud memory management.
 */

const https = require('https');
const http = require('http');

class LocalApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:18799';
    this.apiKey = options.apiKey || '';
    this.timeout = options.timeout || 30000;
  }

  async request(method, path, data = null) {
    const url = new URL(path, this.baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
        },
        timeout: this.timeout,
      };

      const req = lib.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const json = body ? JSON.parse(body) : {};
            resolve(json);
          } catch (e) {
            resolve({ raw: body });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));

      if (data) {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  // === Memories ===

  async getMemories(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request('GET', `/api/memories${query ? '?' + query : ''}`);
  }

  async getMemory(id) {
    return this.request('GET', `/api/memories/${id}`);
  }

  async createMemory(data) {
    return this.request('POST', '/api/memories', data);
  }

  async updateMemory(id, data) {
    return this.request('PUT', `/api/memories/${id}`, data);
  }

  async deleteMemory(id) {
    return this.request('DELETE', `/api/memories/${id}`);
  }

  async searchMemories(query, params = {}) {
    const queryParams = { q: query, ...params };
    const query = new URLSearchParams(queryParams).toString();
    return this.request('GET', `/api/memories/search?${query}`);
  }

  // === Tasks ===

  async getTasks(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request('GET', `/api/tasks${query ? '?' + query : ''}`);
  }

  async getTask(id) {
    return this.request('GET', `/api/tasks/${id}`);
  }

  async createTask(data) {
    return this.request('POST', '/api/tasks', data);
  }

  async updateTask(id, data) {
    return this.request('PUT', `/api/tasks/${id}`, data);
  }

  async deleteTask(id) {
    return this.request('DELETE', `/api/tasks/${id}`);
  }

  // === Skills ===

  async getSkills(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request('GET', `/api/skills${query ? '?' + query : ''}`);
  }

  async getSkill(id) {
    return this.request('GET', `/api/skills/${id}`);
  }

  async createSkill(data) {
    return this.request('POST', '/api/skills', data);
  }

  async updateSkill(id, data) {
    return this.request('PUT', `/api/skills/${id}`, data);
  }

  async deleteSkill(id) {
    return this.request('DELETE', `/api/skills/${id}`);
  }

  // === Analytics ===

  async getAnalytics() {
    return this.request('GET', '/api/analytics');
  }

  async getOverview() {
    return this.request('GET', '/api/analytics/overview');
  }

  async getMemoryTrends(days = 7) {
    return this.request('GET', `/api/analytics/memory-trends?days=${days}`);
  }

  async getTaskEfficiency() {
    return this.request('GET', '/api/analytics/task-efficiency');
  }

  async getSkillQuality() {
    return this.request('GET', '/api/analytics/skill-quality');
  }

  // === Health ===

  async ping() {
    try {
      await this.request('GET', '/health');
      return true;
    } catch (e) {
      return false;
    }
  }

  async getStats() {
    return this.request('GET', '/api/stats');
  }
}

module.exports = LocalApiClient;
