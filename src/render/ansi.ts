/**
 * ANSI 装飾。8色 + bold/dim のみ使用（256色・truecolor 不使用。docs/SPEC.md §5）。
 * 色の有効判定はここに集約する。
 */

export interface Palette {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
}

const wrap = (open: string, close: string) => (s: string) =>
  s === "" ? s : `[${open}m${s}[${close}m`;

const identity = (s: string) => s;

export function makeAnsi(enabled: boolean): Palette {
  if (!enabled) {
    return {
      bold: identity,
      dim: identity,
      red: identity,
      green: identity,
      yellow: identity,
    };
  }
  return {
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    red: wrap("31", "39"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39"),
  };
}

/** 優先順位: --no-color > NO_COLOR > FORCE_COLOR=1 > isTTY（docs/SPEC.md §1）。 */
export function resolveColor(
  noColorFlag: boolean,
  env: Record<string, string | undefined>,
  isTTY: boolean,
): boolean {
  if (noColorFlag) return false;
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["FORCE_COLOR"] === "1") return true;
  return isTTY;
}
