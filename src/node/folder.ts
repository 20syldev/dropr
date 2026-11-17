import fs from 'fs';

/**
 * Tells whether a packages folder can be scanned: it exists, is a folder and can be listed and entered.
 *
 * @param folder - Absolute path of the packages folder
 * @param err - Receives the problem when the folder cannot be scanned
 * @returns true when the folder can be scanned, false after the problem is reported
 */
export function readableFolder(folder: string, err: (text: string) => void): boolean {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        err(`Packages folder ${folder} is not a folder.`);

        return false;
    }
    try {
        fs.accessSync(folder, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
        err(`Packages folder ${folder} cannot be read.`);

        return false;
    }

    return true;
}
