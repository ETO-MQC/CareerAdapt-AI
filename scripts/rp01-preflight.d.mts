export function assertRp01RuntimeParity(projectRoot: string, runtimeRoot: string | undefined): Array<{
  name: string;
  sourceSha256: string;
  bundledSha256: string;
}>;
