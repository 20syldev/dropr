// One decision of the ledger: what the quirk was, what it becomes and who may notice
export interface Change {
    id: string;
    area: string;
    decision: 'keep' | 'change' | 'pending';
    synthetic?: string;
    was: string;
    now: string;
    clients: string;
    note: string;
}

// Decisions of the release in progress, each one a visible change of a quirk; the ledger is emptied after the release
export const CHANGES: Change[] = [];
