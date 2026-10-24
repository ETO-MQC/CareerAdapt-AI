/** Identity labels must not become job targets simply because they appear in the contact row. */
export function isPoliticalIdentityLabel(value: string) {
  return /^(?:政治面貌[:：]?)?(?:中共(?:预备)?党员|共产党员|共青团员|团员|群众|无党派人士|民主党派成员)$/u.test(value.replace(/\s/gu, ""));
}
