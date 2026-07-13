import JSZip from "jszip";
import { summarizeDiff } from "./diff.ts";
import type { AppState, DailyEntry, DiffSummary, Version } from "./types.ts";

export const fullBackupJsonPath = "zhuzi-data.json";
export const analysisBackupJsonPath = "analysis/zhuzi-analysis.json";

export type AnalysisVersion = Omit<Version, "diff_from_previous"> & {
  diff_summary: DiffSummary;
};

export type AnalysisEntry = Omit<DailyEntry, "versions"> & {
  versions: AnalysisVersion[];
};

export type AnalysisAppState = Omit<AppState, "entries"> & {
  entries: AnalysisEntry[];
};

export type AnalysisBackupPayload<T extends { state: AppState }> = Omit<T, "state"> & {
  export_profile: "analysis";
  derived_fields_included: {
    diff_summary: true;
    full_diff: false;
  };
  state: AnalysisAppState;
};

export type ImportFile = Blob & {
  name: string;
  type: string;
};

export async function readBackupPayload(file: ImportFile): Promise<unknown> {
  if (isZipBackupFile(file)) {
    const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
    const candidates = [fullBackupJsonPath, "char300-lab-data.json", analysisBackupJsonPath];
    let parseError: unknown = null;

    for (const path of candidates) {
      const dataFile = zip.file(path);
      if (!dataFile) {
        continue;
      }
      try {
        return JSON.parse(await dataFile.async("string")) as unknown;
      } catch (error) {
        parseError = error;
      }
    }

    if (parseError) {
      throw parseError;
    }
    throw new Error("Backup JSON missing from zip");
  }

  return JSON.parse(await file.text()) as unknown;
}

export function createAnalysisBackupPayload<T extends { state: AppState }>(payload: T): AnalysisBackupPayload<T> {
  return {
    ...payload,
    export_profile: "analysis",
    derived_fields_included: {
      diff_summary: true,
      full_diff: false
    },
    state: {
      ...payload.state,
      entries: payload.state.entries.map((entry) => ({
        ...entry,
        versions: entry.versions.map((version, index, versions) => {
          const { diff_from_previous, ...versionWithoutDiff } = version;
          void diff_from_previous;
          return {
            ...versionWithoutDiff,
            diff_summary: summarizeDiff(versions[index - 1]?.content ?? "", version.content)
          };
        })
      }))
    }
  };
}

export function addBackupJsonFiles<T extends { state: AppState }>(zip: JSZip, payload: T): void {
  zip.file(fullBackupJsonPath, JSON.stringify(payload, null, 2));
  zip.file(analysisBackupJsonPath, JSON.stringify(createAnalysisBackupPayload(payload), null, 2));
}

export async function generateCompressedZip(zip: JSZip): Promise<Blob> {
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

export function isZipBackupFile(file: Pick<ImportFile, "name" | "type">): boolean {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}
