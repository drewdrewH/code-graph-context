import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const DEBUG_LOG_FILE = 'debug-search.log';
const LOG_SEPARATOR = '---';
const JSON_INDENT = 2;

export const hashFile = async (filePath: string): Promise<string> => {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

export const debugLog = async (message: string, data?: any): Promise<void> => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, JSON_INDENT) : ''}\n${LOG_SEPARATOR}\n`;

  try {
    await fs.appendFile(path.join(process.cwd(), DEBUG_LOG_FILE), logEntry);
  } catch (error) {
    console.error('Failed to write debug log:', error);
  }
};
