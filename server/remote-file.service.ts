import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  HERMES_REMOTE_HOST,
  HERMES_REMOTE_CONTAINER_REPORT_DIR,
  HERMES_REMOTE_REPORT_DIR,
  HERMES_REMOTE_SSH_KEY,
  HERMES_REMOTE_USER,
} from './config.js';

function isRemote(): boolean {
  return HERMES_REMOTE_HOST.length > 0;
}

const SSH_EXE = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')
  : 'ssh';

function sshArgs(): string[] {
  const keyPath = HERMES_REMOTE_SSH_KEY.startsWith('~')
    ? path.join(os.homedir(), HERMES_REMOTE_SSH_KEY.slice(1))
    : HERMES_REMOTE_SSH_KEY;
  return ['-i', keyPath, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', `${HERMES_REMOTE_USER}@${HERMES_REMOTE_HOST}`];
}

function execSsh(command: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [...sshArgs(), command];
    execFile(SSH_EXE, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`SSH exec failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export interface RemoteDirent {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface RemoteStat {
  size: number;
  mtimeMs: number;
  isFile: boolean;
}

@Injectable()
export class RemoteFileService {
  readonly remoteDir = HERMES_REMOTE_REPORT_DIR;

  private toHostPath(filePath: string): string {
    if (!isRemote()) return filePath;
    if (filePath === HERMES_REMOTE_CONTAINER_REPORT_DIR) return this.remoteDir;
    if (filePath.startsWith(`${HERMES_REMOTE_CONTAINER_REPORT_DIR}/`)) {
      return `${this.remoteDir}${filePath.slice(HERMES_REMOTE_CONTAINER_REPORT_DIR.length)}`;
    }
    return filePath;
  }

  async readFile(filePath: string): Promise<string> {
    filePath = this.toHostPath(filePath);
    if (!isRemote()) return fs.promises.readFile(filePath, 'utf-8');
    return execSsh(`cat '${filePath}'`);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    filePath = this.toHostPath(filePath);
    if (!isRemote()) {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return;
    }
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    await execSsh(`mkdir -p '${path.dirname(filePath)}' && echo '${b64}' | base64 -d > '${filePath}'`);
  }

  async readdir(dirPath: string): Promise<RemoteDirent[]> {
    dirPath = this.toHostPath(dirPath);
    if (!isRemote()) {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        isFile: e.isFile(),
        isDirectory: e.isDirectory(),
      }));
    }
    const output = await execSsh(
      `ls -1p --time-style=full-iso '${dirPath}' 2>/dev/null | while IFS= read -r line; do name=\${line%%[/ ]*}; if [ "\${line: -1}" = "/" ]; then echo "D \$name"; else echo "F \$name"; fi; done`,
    );
    return output
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const type = line[0];
        const name = line.slice(2).trim();
        return { name, isFile: type === 'F', isDirectory: type === 'D' };
      });
  }

  async stat(filePath: string): Promise<RemoteStat> {
    filePath = this.toHostPath(filePath);
    if (!isRemote()) {
      const s = await fs.promises.stat(filePath);
      return { size: s.size, mtimeMs: s.mtimeMs, isFile: s.isFile() };
    }
    const output = await execSsh(`stat -c '%s %Y %F' '${filePath}'`);
    const [sizeStr, mtimeStr, typeStr] = output.trim().split(' ');
    return {
      size: Number(sizeStr),
      mtimeMs: Number(mtimeStr) * 1000,
      isFile: typeStr === 'regular',
    };
  }

  async mkdir(dirPath: string): Promise<void> {
    dirPath = this.toHostPath(dirPath);
    if (!isRemote()) {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return;
    }
    await execSsh(`mkdir -p '${dirPath}'`);
  }

  async exists(filePath: string): Promise<boolean> {
    filePath = this.toHostPath(filePath);
    if (!isRemote()) {
      try {
        const s = await fs.promises.stat(filePath);
        return s.isFile();
      } catch {
        return false;
      }
    }
    try {
      const output = await execSsh(`test -f '${filePath}' && echo YES || echo NO`);
      return output.trim() === 'YES';
    } catch {
      return false;
    }
  }

  joinPath(...segments: string[]): string {
    if (!isRemote()) return path.join(...segments);
    return segments.join('/');
  }

  resolvePath(filePath: string): string {
    if (!isRemote()) return path.resolve(filePath);
    return filePath.startsWith('/') ? filePath : `${this.remoteDir}/${filePath}`;
  }

  remapToReportDir(filePath: string): string | null {
    filePath = this.toHostPath(filePath);
    const filename = path.basename(filePath);
    if (!filename.toLowerCase().endsWith('.md')) return null;
    return this.joinPath(this.remoteDir, filename);
  }

  isInsideReportDir(filePath: string): boolean {
    filePath = this.toHostPath(filePath);
    if (!isRemote()) {
      const root = path.resolve(this.remoteDir).toLowerCase();
      const resolved = path.resolve(filePath).toLowerCase();
      return resolved === root || resolved.startsWith(`${root}${path.sep}`);
    }
    return filePath.startsWith(this.remoteDir);
  }
}
