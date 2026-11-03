import { demoCareerProfile } from '../../src/data/demoProfile';
import { canonicalProfileBasics, canonicalProfileLibraryItems, profileSectionCatalog } from '../../src/domain/profile/canonicalLibrary';
import { profileCategoryForCanonicalSection } from '../../src/domain/profile/profileCategories';
import { resumeFieldCatalog } from '../../src/domain/resumeFields/fieldCatalog';
import { ResumeItemV2Schema } from '../../src/domain/schemas/resumeV2';
import { displayProfileSchema, type DisplayProfile, type DisplayItem } from './profile-read-model';
function fields(section: string, record: Record<string, unknown>) {
    return resumeFieldCatalog.filter(f => f.sectionType === section).flatMap(f => {
        const key = f.id.split('.')[1], value = record[key];
        if (value === undefined || value === '' || Array.isArray(value) && !value.length)
            return [];
        return [{ key, label: f.label, values: Array.isArray(value) ? value.map(String) : [typeof value === 'boolean' ? (value ? '是' : '否') : String(value)], multiline: f.valueType === 'text' || f.valueType === 'string_list' }];
    }).concat(Array.isArray(record.customFields) ? record.customFields.map((f: {
        id: string;
        label: string;
        value: unknown;
    }) => ({ key: f.id, label: f.label, values: Array.isArray(f.value) ? f.value.map(String) : [String(f.value)], multiline: true })) : []);
}
/** Only the built-in demo and explicit synthetic scenarios; never a user data client. */
export function createFaithfulFixture(): DisplayProfile {
    const basics = canonicalProfileBasics(demoCareerProfile), projected = canonicalProfileLibraryItems(demoCareerProfile);
    const facts = [...demoCareerProfile.experiences.flatMap(e => e.facts), ...demoCareerProfile.skills.flatMap(s => s.fact ? [s.fact] : []), ...demoCareerProfile.certificates.flatMap(c => c.fact ? [c.fact] : [])];
    const items: DisplayItem[] = projected.map(item => {
        const record = item.data as unknown as Record<string, unknown>;
        return { id: item.id, category: profileCategoryForCanonicalSection(item.sectionType), title: item.title, subtitle: item.subtitle, body: item.body, date: [record.startDate, record.current ? '至今' : record.endDate, record.awardedAt, record.issuedAt].filter(Boolean).join(' — '), fields: fields(item.sectionType, record), sources: item.factIds.flatMap(id => facts.filter(f => f.id === id).flatMap(f => f.provenance.map(p => `合成示例来源 · ${p.sourceType} · ${p.sourceText}`))), used: demoCareerProfile.experiences.some(e => e.id === item.id && e.resumeDrafts.length > 0), archived: false, updatedAt: demoCareerProfile.updatedAt.slice(0, 10), data: record };
    });
    if (basics.summary && !items.some(i => i.category === 'summary'))
        items.push({ id: 'summary', category: 'summary', title: '自我评价', subtitle: '用于简历概述，可在具体简历中独立修改', body: basics.summary, date: '', fields: fields('summary', { text: basics.summary }), sources: ['项目内置示例中的自我评价 · 合成资料'], used: false, archived: false, updatedAt: '2026-07-01', data: { text: basics.summary } });
    const extras = [
        { id: 'synthetic-education', sectionType: 'education', school: '虚构星舟学院', degree: '本科', major: '经济管理（合成）', location: '虚构星舟城', startDate: '2022-09', endDate: '2026-06', courses: ['统计学', '数据分析'], description: '全合成教育条目，用于核验教育专用字段。', highlights: ['完成合成课程研究。'] },
        { id: 'synthetic-work', sectionType: 'work', organization: '虚构云帆研究室', role: '资料研究助理（合成）', department: '研究组', startDate: '2026-07', current: true, description: '全合成工作场景，不代表真实任职。', highlights: ['整理虚构研究记录并制作资料索引。'] },
        { id: 'synthetic-project', sectionType: 'project', title: '虚构灯塔信息导航', role: '设计与验证', organization: '虚构课程团队', startDate: '2025-03', endDate: '2025-06', tools: ['Figma', 'TypeScript'], background: '为不存在的校园构建信息导航。', description: '全合成项目，用于验证背景、职责与成果分开呈现。', highlights: ['梳理信息层级。', '制作交互流程并核对字段。'], outcomes: ['形成一份合成原型及验收清单。'] },
        { id: 'synthetic-language', sectionType: 'languages', language: '虚构星语', level: '熟悉', testName: '合成语言测评', score: '演示分数', description: '完全虚构的语言条目。' }
    ].map(value => ResumeItemV2Schema.parse(value));
    for (const data of extras) {
        const record = data as unknown as Record<string, unknown>;
        items.push({ id: data.id, category: profileCategoryForCanonicalSection(data.sectionType), title: String(record.title || record.school || record.organization || record.language), subtitle: String(record.role || record.degree || record.level || ''), body: String(record.description || ''), date: [record.startDate, record.current ? '至今' : record.endDate].filter(Boolean).join(' — '), fields: fields(data.sectionType, record), sources: ['全合成资料 · 无外部来源文件或真实事实。'], used: false, archived: false, updatedAt: '2026-07-01', data: record });
    }
    const archived = items.find(i => i.category === 'project')!;
    items.push({ ...archived, id: 'synthetic-archived-project', title: '虚构归档项目（合成）', archived: true, used: false, sources: ['全合成归档状态示例；没有执行真实归档。'] });
    items.unshift({ id: 'basics', category: 'basics', title: demoCareerProfile.name, subtitle: [basics.email, basics.phone, basics.location].filter(Boolean).join(' / '), body: basics.summary || '', date: '', fields: fields('basics', basics), sources: ['项目内置示例资料 · 非用户资料'], used: true, archived: false, updatedAt: '2026-07-01', data: basics });
    return displayProfileSchema.parse({ marker: '合成示例 · 只读 · 未连接正式资料库', name: demoCareerProfile.name, version: 'V1 · 示例版本', createdAt: '2026/07/01', background: demoCareerProfile.preference.targetRoles.join(' / '), basics: fields('basics', basics), categories: profileSectionCatalog.map(s => ({ id: profileCategoryForCanonicalSection(s.id), sectionType: s.id, label: s.label, repeatable: s.repeatable })), items });
}
