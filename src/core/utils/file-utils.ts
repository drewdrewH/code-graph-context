import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { LOG_CONFIG } from '../../constants.js';

export const hashFile = async (filePath: string): Promise<string> => {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

export const debugLog = async (message: string, data?: any): Promise<void> => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n${data ? JSON.stringify(data, null, LOG_CONFIG.jsonIndent) : ''}\n${LOG_CONFIG.separator}\n`;

  try {
    await fs.appendFile(path.join(process.cwd(), LOG_CONFIG.debugLogFile), logEntry);
  } catch (error) {
    console.error('Failed to write debug log:', error);
  }
};
