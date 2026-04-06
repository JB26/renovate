import { partial } from '~test/util.ts';
import { DockerDatasource } from '../../../../../modules/datasource/docker/index.ts';
import * as datasource from '../../../../../modules/datasource/index.ts';
import * as dockerVersioning from '../../../../../modules/versioning/docker/index.ts';
import * as npmVersioning from '../../../../../modules/versioning/npm/index.ts';
import type { BranchUpgradeConfig } from '../../../../types.ts';
import * as lookup from '../../../process/lookup/index.ts';
import * as releases from './releases.ts';

describe('workers/repository/update/pr/changelog/releases', () => {
  describe('getReleaseNotes()', () => {
    beforeEach(() => {
      vi.spyOn(datasource, 'getPkgReleases').mockResolvedValueOnce({
        releases: [
          {
            version: '1.0.0',
          },
          {
            version: '1.0.1-rc0',
          },
          {
            version: '1.0.1-rc1',
          },
          {
            version: '1.0.1',
          },
          {
            version: '1.1.0-rc0',
          },
          {
            version: '1.1.0',
          },
          {
            version: '1.2.0-rc0',
          },
          {
            version: '1.2.0-rc1',
          },
        ],
      });
    });

    it('should contain only stable', async () => {
      const config = partial<BranchUpgradeConfig>({
        datasource: 'some-datasource',
        packageName: 'some-depname',
        versioning: npmVersioning.id,
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
      });
      const res = await releases.getInRangeReleases(config);
      expect(res).toEqual([
        { version: '1.0.0' },
        { version: '1.0.1' },
        { version: '1.1.0' },
      ]);
    });

    it('should contain currentVersion unstable', async () => {
      const config = partial<BranchUpgradeConfig>({
        datasource: 'some-datasource',
        packageName: 'some-depname',
        versioning: npmVersioning.id,
        currentVersion: '1.0.1-rc0',
        newVersion: '1.1.0',
      });
      const res = await releases.getInRangeReleases(config);
      expect(res).toEqual([
        { version: '1.0.1-rc0' },
        { version: '1.0.1-rc1' },
        { version: '1.0.1' },
        { version: '1.1.0' },
      ]);
    });

    it('should contain newVersion unstable', async () => {
      const config = partial<BranchUpgradeConfig>({
        datasource: 'some-datasource',
        packageName: 'some-depname',
        versioning: npmVersioning.id,
        currentVersion: '1.0.1',
        newVersion: '1.2.0-rc1',
      });
      const res = await releases.getInRangeReleases(config);
      expect(res).toEqual([
        { version: '1.0.1' },
        { version: '1.1.0' },
        { version: '1.2.0-rc0' },
        { version: '1.2.0-rc1' },
      ]);
    });

    it('should contain both currentVersion newVersion unstable', async () => {
      const config = partial<BranchUpgradeConfig>({
        datasource: 'some-datasource',
        packageName: 'some-depname',
        versioning: npmVersioning.id,
        currentVersion: '1.0.1-rc0',
        newVersion: '1.2.0-rc1',
      });
      const res = await releases.getInRangeReleases(config);
      expect(res).toEqual([
        { version: '1.0.1-rc0' },
        { version: '1.0.1-rc1' },
        { version: '1.0.1' },
        { version: '1.1.0' },
        { version: '1.2.0-rc0' },
        { version: '1.2.0-rc1' },
      ]);
    });

    it('should valueToVersion', async () => {
      const config = partial<BranchUpgradeConfig>({
        datasource: 'some-datasource',
        packageName: 'some-depname',
        versioning: dockerVersioning.id,
        currentVersion: '1.0.1-rc0',
        newVersion: '1.2.0-rc0',
      });
      const res = await releases.getInRangeReleases(config);
      expect(res).toEqual([
        { version: '1.0.1' },
        { version: '1.1.0' },
        { version: '1.2.0' },
      ]);
    });

    it('should return any previous version if current version is non-existent', async () => {
      const config = partial<BranchUpgradeConfig>({
        datasource: 'some-datasource',
        packageName: 'some-depname',
        versioning: npmVersioning.id,
        currentVersion: '1.0.2',
        newVersion: '1.1.0',
      });
      const res = await releases.getInRangeReleases(config);
      expect(res).toEqual([{ version: '1.0.1' }, { version: '1.1.0' }]);
    });
  });

  describe('getInRangeReleases() integration with lookupUpdates', () => {
    it('finds releases when currentCompatibility flows from lookupUpdates', async () => {
      const rawReleases = [
        { version: '1.0.0-alpine' },
        { version: '1.1.0-alpine' },
        { version: '1.2.0-alpine' },
      ];

      // Mock getRawPkgReleases to return the raw data
      // @ts-expect-error -- mock
      vi.spyOn(datasource, 'getRawPkgReleases').mockReturnValue({
        transform: vi.fn().mockReturnThis(),
        unwrap: vi.fn().mockResolvedValue({
          val: { releases: rawReleases },
        }),
      });

      // This simulates the real behavior of applyVersionCompatibility:
      // if a compatibility group is expected by the regex but missing in config,
      // it filters out releases that have a suffix.
      vi.spyOn(datasource, 'getPkgReleases').mockImplementation((config) => {
        if (
          config.versionCompatibility &&
          config.currentCompatibility === undefined
        ) {
          return Promise.resolve({ releases: [] });
        }
        return Promise.resolve({
          releases: [
            { version: '1.0.0', versionOrig: '1.0.0-alpine' },
            { version: '1.1.0', versionOrig: '1.1.0-alpine' },
            { version: '1.2.0', versionOrig: '1.2.0-alpine' },
          ],
        });
      });

      // 1. PHASE: LOOKUP (extraction)
      const lookupConfig = partial<any>({
        datasource: DockerDatasource.id,
        packageName: 'node',
        currentValue: '1.0.0-alpine',
        versionCompatibility: '^(?<version>[^-]+)(?<compatibility>.*)$',
      });

      const lookupResult = await lookup.lookupUpdates(lookupConfig);
      const res = lookupResult.unwrapOrThrow();

      // 2. PHASE: PR generation (retrieval)
      const branchUpgradeConfig = partial<BranchUpgradeConfig>({
        ...lookupConfig,
        ...res,
        currentVersion: '1.0.0',
        newVersion: '1.2.0',
      });

      const inRangeReleases =
        await releases.getInRangeReleases(branchUpgradeConfig);

      expect(inRangeReleases).toHaveLength(3);
      expect(inRangeReleases![0].version).toBe('1.0.0');
      expect(inRangeReleases![1].version).toBe('1.1.0');
      expect(inRangeReleases![2].version).toBe('1.2.0');
    });
  });
});
