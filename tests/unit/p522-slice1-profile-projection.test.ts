import { describe, expect, it } from 'vitest';
import { createFaithfulFixture } from '../../poc/host-experience/profile-fixture';
import { faithfulReadClient, displayProfileSchema } from '../../poc/host-experience/profile-read-model';
import fixture from '../../poc/host-experience/profile-fixture.json';
import { demoCareerProfile } from '../../src/data/demoProfile';
import { canonicalProfileLibraryItems, profileSectionCatalog } from '../../src/domain/profile/canonicalLibrary';
import { profileCategoryForCanonicalSection } from '../../src/domain/profile/profileCategories';
describe('Slice 1 display projection contract', () => {
    it('preserves every canonical category, item and structured field without mutating the demo', () => {
        const before = JSON.stringify(demoCareerProfile), profile = createFaithfulFixture();
        expect(profile).toEqual(fixture);
        expect(profile.categories.map(c => c.sectionType)).toEqual(profileSectionCatalog.map(c => c.id));
        expect(profile.categories.map(c => c.id)).toEqual(profileSectionCatalog.map(c => profileCategoryForCanonicalSection(c.id)));
        for (const item of canonicalProfileLibraryItems(demoCareerProfile)) {
            const result = profile.items.find(i => i.id === item.id)!;
            expect(result).toBeDefined();
            expect(result.data).toEqual(item.data);
            expect(result.body).toEqual(item.body);
        }
        expect(JSON.stringify(demoCareerProfile)).toBe(before);
    });
    it('keeps type-specific fields, source labels and an archive distinct from active items', () => {
        const profile = createFaithfulFixture();
        expect(profile.items.find(i => i.id === 'synthetic-education')!.fields.map(f => f.key)).toEqual(expect.arrayContaining(['school', 'major', 'degree', 'courses']));
        expect(profile.items.find(i => i.id === 'synthetic-project')!.fields.map(f => f.key)).toEqual(expect.arrayContaining(['tools', 'background', 'highlights', 'outcomes']));
        expect(profile.items.find(i => i.category === 'certificate')!.fields.map(f => f.key)).toContain('issuer');
        expect(profile.items.some(i => i.archived)).toBe(true);
        expect(profile.items.filter(i => i.archived).every(i => !i.used)).toBe(true);
        expect(profile.marker).toBe('合成示例 · 只读 · 未连接正式资料库');
    });
    it('offers only a read method, isolates response mutation and rejects invalid payloads', async () => {
        expect(Object.keys(faithfulReadClient)).toEqual(['getProfile']);
        const first = displayProfileSchema.parse(await faithfulReadClient.getProfile());
        first.items[0].title = 'altered locally';
        expect(displayProfileSchema.parse(await faithfulReadClient.getProfile()).items[0].title).not.toBe('altered locally');
        expect(displayProfileSchema.safeParse({ invalid: true }).success).toBe(false);
    });
});
