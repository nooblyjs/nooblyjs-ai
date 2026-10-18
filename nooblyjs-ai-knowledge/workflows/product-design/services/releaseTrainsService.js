/**
 * @fileoverview releaseTrainsService — Target Process **Agile Release Trains**,
 * and the root of the Product content tree.
 *
 * retrieve() caches the AgileReleaseTrains collection to `cache/releasetrains.json`.
 * createReleaseTrainFolders() assembles the full Product hierarchy under the
 * configured content folder:
 *
 *   {contentfolder}/<Release Train>/         (no .home.md — the folder itself is the landing)
 *       <Value Stream>/                     AgileReleaseTrainValueStreams (ART -> VS)
 *           .home.md
 *           <Epic Name>/                    ValueStreamEpics (VS -> Epic)
 *               .home.md
 *               Features/<Feature>.md       Features whose Epic is this epic, one page each
 *           <Portfolio Epic Name>/          ValueStreamPortfolioEpics (VS -> PortfolioEpic)
 *               .home.md
 *               Features/<Feature>.md       Features whose PortfolioEpic is this PE
 *       Portfolio - <Project>/              fallback: epics / PEs that map to the train
 *           .home.md                        but to none of its value streams are grouped
 *           <Epic Name>/ ...                by the Portfolio (Project) they belong to
 *           <Portfolio Epic Name>/ ...
 *
 * Epics and portfolio epics are siblings (never parent/child). One that is mapped
 * to a value stream is placed under that value stream; one that is not is placed
 * under a `Portfolio - <Project>` folder, since every epic / portfolio epic always
 * belongs to a Portfolio (Project) and an Agile Release Train. Both epics and
 * portfolio epics carry their features.
 *
 * Sub-folder pages are enriched from the `valuestreams.json`, `epics.json`,
 * `portfolioepics.json` and `features.json` caches when present (falling back to
 * the name carried by the mapping otherwise). For a fully populated --write run,
 * run the Value Streams, Epics, Portfolio Epics, Features and all the mapping
 * *Retrieve* steps first.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');
const EpicsService = require('./epicsService.js');
const FeaturesService = require('./featuresService.js');
const RequestsService = require('./requestsService.js');
const fileUtils = require('../utilities/filesystem.js');
const md = require('../utilities/markdown.js');

const RELEASE_TRAIN_INCLUDE = ['Id', 'Name', 'Description'];

// The Portfolio (fallback) bucket is prefixed so it groups apart from the value
// stream folders when sorted by name.
const PORTFOLIO_PREFIX = 'Portfolio - ';

// Continuous Exploration folder: holds subfolders for Requests (Ideas / Issues / Questions)
// linked to an epic, portfolio epic, or release train.
const CONTINUOUS_EXPLORATION = 'Continuous Exploration';

// Features folder: holds one page per Feature belonging to the parent epic /
// portfolio epic / release train. This replaced a single consolidated
// `Features.md`, which grew too large to read at a useful resolution — the
// superseded file is removed on the next build (see writeFeatureFolder).
const FEATURES_FOLDER = 'Features';

// Used when an epic / portfolio epic has no resolvable Project name.
const UNASSIGNED_PORTFOLIO = 'Unassigned Portfolio';

class ReleaseTrainsService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
        // Reused so an epic page / feature page under a release train is identical
        // to the same entity's project-rooted page.
        this.epicsService = new EpicsService(settings);
        this.featuresService = new FeaturesService(settings);
        this.requestsService = new RequestsService(settings);
    }

    /**
     * Retrieve all Agile Release Trains and cache them.
     * @returns {Promise<Array<object>>} The release trains.
     */
    async retrieve() {
        const releaseTrains = await this.tp.retrieveAll('AgileReleaseTrains', { include: RELEASE_TRAIN_INCLUDE });
        super.writeCache('releasetrains.json', releaseTrains);
        console.log(`[releaseTrainsService] retrieved ${releaseTrains.length} release trains`);
        return releaseTrains;
    }

    /**
     * Load every cache the tree needs, once, into a reusable context.
     * @returns {object}
     */
    buildContext() {
        const requestEpicMappings = super.readCache('requestepics.json');
        const requestPortfolioEpicMappings = super.readCache('requestportfolioepics.json');
        // Request Ids already placed beneath an epic / portfolio epic — these are
        // excluded from the release-train-level Continuous Exploration fallback.
        const linkedRequestIds = new Set();
        for (const m of requestEpicMappings) {
            if (m.Request) linkedRequestIds.add(m.Request.Id);
        }
        for (const m of requestPortfolioEpicMappings) {
            if (m.Request) linkedRequestIds.add(m.Request.Id);
        }
        return {
            artValueStreamMappings: super.readCache('agilereleasetrainvaluestreams.json'),
            valueStreamEpicMappings: super.readCache('valuestreamepics.json'),
            valueStreamPortfolioEpicMappings: super.readCache('valuestreamportfolioepics.json'),
            epicTrainMappings: super.readCache('epicreleasetrains.json'),
            portfolioEpicTrainMappings: super.readCache('portfolioepicreleasetrains.json'),
            valueStreamsById: new Map(super.readCache('valuestreams.json').map((vs) => [vs.Id, vs])),
            epicsById: new Map(super.readCache('epics.json').map((epic) => [epic.Id, epic])),
            portfolioEpicsById: new Map(super.readCache('portfolioepics.json').map((pe) => [pe.Id, pe])),
            features: super.readCache('features.json'),
            // Enabler features carry an Epic reference — rendered as an
            // "## Enabler Features" table on the parent epic's home page.
            enablerFeatures: super.readCache('enablerfeatures.json'),
            // Continuous Exploration: Requests and the junctions that link them
            // to an epic / portfolio epic.
            requests: super.readCache('requests.json'),
            requestsById: new Map(super.readCache('requests.json').map((r) => [r.Id, r])),
            requestEpicMappings,
            requestPortfolioEpicMappings,
            linkedRequestIds,
            // Requirements and the junctions linking them to an epic / portfolio
            // epic / feature. Rendered as a "## Requirements" table on each page.
            requirementsById: new Map(super.readCache('requirements.json').map((r) => [r.Id, r])),
            requirementEpicMappings: super.readCache('requirementepics.json'),
            requirementPortfolioEpicMappings: super.readCache('requirementportfolioepics.json'),
            requirementFeatureMappings: super.readCache('requirementfeatures.json'),
        };
    }

    /**
     * Work out, for one release train, the value streams beneath it (each with
     * its epics / portfolio epics) and the Portfolio groups holding the epics /
     * portfolio epics that map to the train but to none of its value streams.
     * @param {object} releaseTrain
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @returns {{valueStreams: Array<object>, portfolios: Array<object>}}
     */
    planReleaseTrain(releaseTrain, context) {
        const placedEpicIds = new Set();
        const placedPortfolioEpicIds = new Set();

        const valueStreams = this.relatedMembers(context.artValueStreamMappings, 'AgileReleaseTrain', releaseTrain.Id, 'ValueStream')
            .map((ref) => {
                const epics = this.relatedMembers(context.valueStreamEpicMappings, 'ValueStream', ref.Id, 'Epic');
                const portfolioEpics = this.relatedMembers(context.valueStreamPortfolioEpicMappings, 'ValueStream', ref.Id, 'PortfolioEpic');
                epics.forEach((epic) => placedEpicIds.add(epic.Id));
                portfolioEpics.forEach((pe) => placedPortfolioEpicIds.add(pe.Id));
                return { ref, valueStream: context.valueStreamsById.get(ref.Id) || ref, epics, portfolioEpics };
            });

        // Epics / PEs mapped to the train but not carried by any of its value
        // streams, grouped by the Portfolio (Project) they belong to.
        const directEpics = this.relatedMembers(context.epicTrainMappings, 'AgileReleaseTrain', releaseTrain.Id, 'Epic')
            .filter((ref) => !placedEpicIds.has(ref.Id));
        const directPortfolioEpics = this.relatedMembers(context.portfolioEpicTrainMappings, 'AgileReleaseTrain', releaseTrain.Id, 'PortfolioEpic')
            .filter((ref) => !placedPortfolioEpicIds.has(ref.Id));

        const portfolioMap = new Map();
        const portfolioGroup = (name) => {
            if (!portfolioMap.has(name)) {
                portfolioMap.set(name, { name, epics: [], portfolioEpics: [] });
            }
            return portfolioMap.get(name);
        };
        for (const ref of directEpics) {
            portfolioGroup(this.portfolioName(context.epicsById.get(ref.Id))).epics.push(ref);
        }
        for (const ref of directPortfolioEpics) {
            portfolioGroup(this.portfolioName(context.portfolioEpicsById.get(ref.Id))).portfolioEpics.push(ref);
        }
        const portfolios = [...portfolioMap.values()].sort((a, b) => a.name.localeCompare(b.name));

        return { valueStreams, portfolios };
    }

    /**
     * Collapse a filter input into Map<key, Set<value>> — values under the same
     * key OR together, different keys AND together. Mirrors the design-solution
     * filter shape. Accepts an array of single-key objects, a single object, or
     * null/empty (which matches every release train).
     *
     * @example
     *   // only these two trains
     *   [{ "Release Train": "RAINMAKER (RETAIL) MEDIA" }, { "Release Train": "APEX" }]
     *
     * @private
     * @param {Array<object>|object|null} [filter]
     * @returns {Map<string, Set<string>>}
     */
    normalizeFilter(filter) {
        const groups = new Map();
        if (filter == null) return groups;

        const entries = Array.isArray(filter) ? filter : [filter];
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            for (const [k, v] of Object.entries(entry)) {
                if (v == null || v === '') continue;
                if (!groups.has(k)) groups.set(k, new Set());
                groups.get(k).add(v);
            }
        }
        return groups;
    }

    /**
     * Candidate values on a release train for a filter key. "Release Train"
     * resolves to its Name; any other key falls back to the matching top-level
     * field on the train record (e.g. "Description").
     * @private
     * @returns {string[]}
     */
    extractTrainValues(train, key) {
        if (key === 'Release Train') {
            return train.Name ? [train.Name] : [];
        }
        const v = train[key];
        return v == null || v === '' ? [] : [v];
    }

    /**
     * @private
     * @returns {boolean} true when the train matches every filter group.
     */
    matchesReleaseTrain(train, groups) {
        if (groups.size === 0) return true;
        for (const [key, allowed] of groups.entries()) {
            const actuals = this.extractTrainValues(train, key);
            if (!actuals.some((a) => allowed.has(a))) return false;
        }
        return true;
    }

    /**
     * Assemble the full Product tree rooted at the release trains.
     *
     * @param {Array<object>|object|null} [filter] Optional release-train filter
     *   (see {@link ReleaseTrainsService#normalizeFilter}). When omitted, every
     *   train is built; otherwise only matching trains (and their full subtree)
     *   are written. Pair with a workflow `contentfolder` override to route a
     *   filtered slice into its own content folder.
     * @returns {Promise<string[]>} Status messages.
     */
    async createReleaseTrainFolders(filter = null) {
        const releaseTrains = super.readCache('releasetrains.json');
        const context = this.buildContext();
        const messages = [];

        const groups = this.normalizeFilter(filter);
        const matched = releaseTrains.filter((t) => this.matchesReleaseTrain(t, groups));
        if (groups.size > 0) {
            messages.push(`Filter matched ${matched.length} of ${releaseTrains.length} release train(s)`);
        }

        const sorted = matched.slice().sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)));
        for (const releaseTrain of sorted) {
            if (!releaseTrain.Name) {
                messages.push(`Skipped release train ${releaseTrain.Id} (no name)`);
                continue;
            }

            const trainFolder = path.join(this.settings.contentfolder, fileUtils.sanitizeFilename(releaseTrain.Name));
            if (!fileUtils.fileExists(trainFolder)) {
                fileUtils.createFolder(trainFolder);
                messages.push(`Created folder ${trainFolder}`);
            } else {
                messages.push(`Folder exists ${trainFolder}`);
            }

            const plan = this.planReleaseTrain(releaseTrain, context);

            // Value streams (with their epics + portfolio epics).
            for (const vs of plan.valueStreams) {
                const vsFolder = path.join(trainFolder, fileUtils.sanitizeFilename(vs.ref.Name));
                fileUtils.createFolder(vsFolder);
                const vsHome = path.join(vsFolder, '.home.md');
                fileUtils.writeFile(vsHome, this.buildValueStreamHome(vs.valueStream, vs.epics, vs.portfolioEpics));
                messages.push(`Wrote ${vsHome}`);
                for (const ref of vs.epics) {
                    this.writeEpicFolder(vsFolder, ref, context, messages);
                }
                for (const ref of vs.portfolioEpics) {
                    this.writePortfolioEpicFolder(vsFolder, ref, context, messages);
                }
                this.writeEpicOrder(vsFolder, vs.epics, vs.portfolioEpics, context);
            }

            // Portfolio groups (epics + portfolio epics with no value stream).
            for (const portfolio of plan.portfolios) {
                const portfolioFolder = path.join(trainFolder, fileUtils.sanitizeFilename(`${PORTFOLIO_PREFIX}${portfolio.name}`));
                fileUtils.createFolder(portfolioFolder);
                const portfolioHome = path.join(portfolioFolder, '.home.md');
                fileUtils.writeFile(portfolioHome, this.buildPortfolioHome(portfolio.name, portfolio.epics, portfolio.portfolioEpics));
                messages.push(`Wrote ${portfolioHome}`);
                for (const ref of portfolio.epics) {
                    this.writeEpicFolder(portfolioFolder, ref, context, messages);
                }
                for (const ref of portfolio.portfolioEpics) {
                    this.writePortfolioEpicFolder(portfolioFolder, ref, context, messages);
                }
                this.writeEpicOrder(portfolioFolder, portfolio.epics, portfolio.portfolioEpics, context);
            }

            // Features that map to the train but to no epic / portfolio epic —
            // a page each in a Features/ folder at the train level.
            this.writeFeatureFolder(trainFolder, this.trainFeatures(releaseTrain, context), context, messages);

            // Requests that map to the train but to no epic / portfolio epic.
            const trainRequests = this.trainRequests(releaseTrain, context);
            this.writeContinuousExploration(trainFolder, trainRequests, messages);
        }

        return messages;
    }

    /**
     * Create an `<Epic Name>/` folder with a `.home.md`, features.md, and
     * Continuous Exploration subfolder.
     * @param {string} parentFolder - Folder to create the epic folder inside.
     * @param {object} ref - The epic {Id, Name} mapping reference.
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @param {string[]} messages - Status messages, appended in place.
     */
    writeEpicFolder(parentFolder, ref, context, messages) {
        const epic = context.epicsById.get(ref.Id) || ref;
        const epicFeatures = context.features.filter((feature) => feature.Epic && feature.Epic.Id === epic.Id);
        const epicEnablerFeatures = context.enablerFeatures.filter((enabler) => enabler.Epic && enabler.Epic.Id === epic.Id);
        const epicRequests = this.resolveRequests(context.requestEpicMappings, 'Epic', epic.Id, context);
        const epicRequirements = this.resolveRequirements(context.requirementEpicMappings, 'Epic', epic.Id, context);
        const epicFolderName = fileUtils.sanitizeFilename(ref.Name);
        const epicFolder = path.join(parentFolder, epicFolderName);
        fileUtils.createFolder(epicFolder);
        // Green ("success") navigation accent for an On Track epic; cleared otherwise.
        fileUtils.setFolderStatus(parentFolder, epicFolderName, this.isOnTrack(epic) ? 'success' : null);
        const epicPath = path.join(epicFolder, '.home.md');
        fileUtils.writeFile(epicPath, this.epicsService.buildEpicHome(epic, epicFeatures, epicRequests, epicRequirements, epicEnablerFeatures));
        messages.push(`Wrote ${epicPath}`);

        this.writeFeatureFolder(epicFolder, epicFeatures, context, messages);
        this.writeContinuousExploration(epicFolder, epicRequests, messages);
    }

    /**
     * Create a `<Portfolio Epic Name>/` folder with a `.home.md`, features.md, and
     * Continuous Exploration subfolder.
     * @param {string} parentFolder - Folder to create the portfolio epic folder inside.
     * @param {object} ref - The portfolio epic {Id, Name} mapping reference.
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @param {string[]} messages - Status messages, appended in place.
     */
    writePortfolioEpicFolder(parentFolder, ref, context, messages) {
        const portfolioEpic = context.portfolioEpicsById.get(ref.Id) || ref;
        const peFeatures = context.features.filter((feature) => feature.PortfolioEpic && feature.PortfolioEpic.Id === portfolioEpic.Id);
        const peRequests = this.resolveRequests(context.requestPortfolioEpicMappings, 'PortfolioEpic', portfolioEpic.Id, context);
        const peRequirements = this.resolveRequirements(context.requirementPortfolioEpicMappings, 'PortfolioEpic', portfolioEpic.Id, context);
        const peFolderName = fileUtils.sanitizeFilename(ref.Name);
        const peFolder = path.join(parentFolder, peFolderName);
        fileUtils.createFolder(peFolder);
        // Green ("success") navigation accent for an On Track portfolio epic; cleared otherwise.
        fileUtils.setFolderStatus(parentFolder, peFolderName, this.isOnTrack(portfolioEpic) ? 'success' : null);
        const pePath = path.join(peFolder, '.home.md');
        fileUtils.writeFile(pePath, this.buildPortfolioEpicHome(portfolioEpic, peFeatures, peRequests, peRequirements));
        messages.push(`Wrote ${pePath}`);

        this.writeFeatureFolder(peFolder, peFeatures, context, messages);
        this.writeContinuousExploration(peFolder, peRequests, messages);
    }

    /**
     * Order the epic / portfolio epic folders under a parent (a value stream or a
     * Portfolio group) so the "Done" ones float to the top, alphabetically; every
     * other folder then sorts alphabetically after them. Written to the parent's
     * `.settings/file-order.json` — the wiki's applyFileOrder places the listed
     * (Done) names first in this order and default-sorts the rest. Always written
     * (with an empty list when nothing is Done) so a re-run reflects the entities'
     * current state rather than a stale order.
     * @param {string} parentFolder - The value stream / portfolio folder.
     * @param {Array<object>} epicRefs - Epic {Id,Name} refs directly under the parent.
     * @param {Array<object>} portfolioEpicRefs - Portfolio epic {Id,Name} refs directly under the parent.
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     */
    writeEpicOrder(parentFolder, epicRefs, portfolioEpicRefs, context) {
        if (!epicRefs.length && !portfolioEpicRefs.length) {
            return;
        }
        const doneNames = [];
        for (const ref of epicRefs) {
            if (this.isDone(context.epicsById.get(ref.Id) || ref)) {
                doneNames.push(fileUtils.sanitizeFilename(ref.Name));
            }
        }
        for (const ref of portfolioEpicRefs) {
            if (this.isDone(context.portfolioEpicsById.get(ref.Id) || ref)) {
                doneNames.push(fileUtils.sanitizeFilename(ref.Name));
            }
        }
        doneNames.sort((a, b) => a.localeCompare(b));
        fileUtils.setFileOrder(parentFolder, doneNames);
    }

    /**
     * Resolve the Requests linked to an epic / portfolio epic through a Request
     * junction, returning the full Request records (falling back to the {Id,Name}
     * mapping ref when the requests cache is missing an entry), name-sorted.
     * @param {Array<object>} mappings - The Request junction items (requestepics / requestportfolioepics).
     * @param {string} matchKey - The relation to match on ("Epic" | "PortfolioEpic").
     * @param {number} matchId - The Id that relation must equal.
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @returns {Array<object>} The linked Request records.
     */
    resolveRequests(mappings, matchKey, matchId, context) {
        return this.relatedMembers(mappings, matchKey, matchId, 'Request')
            .map((ref) => context.requestsById.get(ref.Id) || ref);
    }

    /**
     * Resolve the Requirements linked to an epic / portfolio epic / feature
     * through a Requirement junction, returning the full Requirement records
     * (falling back to the {Id,Name} mapping ref when the requirements cache is
     * missing an entry), name-sorted.
     * @param {Array<object>} mappings - The Requirement junction items.
     * @param {string} matchKey - The relation to match on ("Epic" | "PortfolioEpic" | "Feature").
     * @param {number} matchId - The Id that relation must equal.
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @returns {Array<object>} The linked Requirement records.
     */
    resolveRequirements(mappings, matchKey, matchId, context) {
        return this.relatedMembers(mappings, matchKey, matchId, 'Requirement')
            .map((ref) => context.requirementsById.get(ref.Id) || ref);
    }

    /**
     * Requests that belong to a release train directly (carry its
     * `AgileReleaseTrain` reference) but are NOT linked to any Epic / Portfolio
     * Epic — these are placed in a Continuous Exploration folder under the train
     * itself rather than under an epic / portfolio epic. Name-sorted.
     * @param {object} releaseTrain
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @returns {Array<object>} The unlinked Request records for this train.
     */
    trainRequests(releaseTrain, context) {
        return context.requests
            .filter((r) => r.AgileReleaseTrain && r.AgileReleaseTrain.Id === releaseTrain.Id)
            .filter((r) => !context.linkedRequestIds.has(r.Id))
            .sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)));
    }

    /**
     * Features that map to a release train directly (carry its `AgileReleaseTrain`
     * reference) but belong to NO Epic or Portfolio Epic — these are written as
     * pages directly under the train folder rather than under an epic / portfolio
     * epic (e.g. Enterprise eCommerce). Cancelled features are already excluded at
     * retrieve, so they never reach here. Name-sorted.
     * @param {object} releaseTrain
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @returns {Array<object>} The train-direct Feature records.
     */
    trainFeatures(releaseTrain, context) {
        return context.features
            .filter((f) => f.AgileReleaseTrain && f.AgileReleaseTrain.Id === releaseTrain.Id)
            .filter((f) => !f.Epic && !f.PortfolioEpic)
            .sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)));
    }

    /**
     * Create a `Features/` folder holding one `<Feature>.md` page per feature of
     * the parent epic / portfolio epic / release train, each carrying its details,
     * description, requirements and a link back to the Target Process record.
     *
     * These features previously shared a single consolidated `Features.md`; that
     * file is deleted here when present, so a rebuild replaces it rather than
     * leaving the wiki showing both it and the folder. The deletion runs even when
     * the parent now has no features, so an emptied parent does not keep a stale
     * consolidated page.
     *
     * @param {string} parentFolder - The epic / portfolio epic / release train folder.
     * @param {Array<object>} features - Features belonging to that parent.
     * @param {object} context - From {@link ReleaseTrainsService#buildContext}.
     * @param {string[]} messages - Status messages, appended in place.
     */
    writeFeatureFolder(parentFolder, features, context, messages) {
        const supersededFile = path.join(parentFolder, `${FEATURES_FOLDER}.md`);
        if (fileUtils.deleteFile(supersededFile)) {
            messages.push(`Removed superseded ${supersededFile}`);
        }

        if (!features.length) {
            return;
        }

        const featuresFolder = path.join(parentFolder, fileUtils.sanitizeFilename(FEATURES_FOLDER));
        fileUtils.createFolder(featuresFolder);

        const used = new Set();
        const sorted = features.slice().sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)));
        for (const feature of sorted) {
            const requirements = this.resolveRequirements(context.requirementFeatureMappings, 'Feature', feature.Id, context);
            const featurePath = path.join(featuresFolder, `${this.featureFileName(feature, used)}.md`);
            fileUtils.writeFile(featurePath, this.featuresService.buildFeatureContent(feature, requirements));
            messages.push(`Wrote ${featurePath}`);
        }
    }

    /**
     * The page name for a feature within its `Features/` folder: its sanitised
     * Name, qualified with the Target Process Id when a sibling feature already
     * claimed that name (two features under one parent may share a name, and the
     * second would otherwise overwrite the first). Falls back to `Feature <Id>`
     * when the name sanitises to nothing.
     * @param {object} feature
     * @param {Set<string>} used - Names already taken in this folder; added to in place.
     * @returns {string}
     */
    featureFileName(feature, used) {
        const base = fileUtils.sanitizeFilename(feature.Name) || `Feature ${feature.Id}`;
        const name = used.has(base) ? `${base} (${feature.Id})` : base;
        used.add(name);
        return name;
    }

    /**
     * Create a `Continuous Exploration/` folder holding one subfolder per Request
     * workflow state (e.g. `Roadmap/`, `Done/`), each holding a subfolder per
     * Request in that state with a `.home.md` detail page. A no-op when there are
     * no linked requests (the folder is only created when something fills it).
     * @param {string} parentFolder - The epic / portfolio epic / release train folder.
     * @param {Array<object>} requests - Resolved Request records (see {@link ReleaseTrainsService#resolveRequests}).
     * @param {string[]} messages - Status messages, appended in place.
     */
    writeContinuousExploration(parentFolder, requests, messages) {
        if (!requests.length) {
            return;
        }
        const ceFolder = path.join(parentFolder, fileUtils.sanitizeFilename(CONTINUOUS_EXPLORATION));
        fileUtils.createFolder(ceFolder);
        // Order the state-grouping folders (Funnel, Roadmap, Analysing, …) rather
        // than leaving them alphabetical.
        fileUtils.setFileOrder(ceFolder, this.requestsService.stateFolderOrder());
        for (const request of requests) {
            if (!request.Name) {
                continue;
            }
            // Group requests under a folder named for their (bucketed) workflow
            // state, e.g. Continuous Exploration/Build in progress/<Request>/.
            const stateFolderName = fileUtils.sanitizeFilename(this.requestsService.stateFolderName(request));
            const stateFolder = path.join(ceFolder, stateFolderName);
            fileUtils.createFolder(stateFolder);

            const requestFolderName = fileUtils.sanitizeFilename(request.Name);
            const requestFolder = path.join(stateFolder, requestFolderName);
            fileUtils.createFolder(requestFolder);
            const requestPath = path.join(requestFolder, '.home.md');
            fileUtils.writeFile(requestPath, this.requestsService.buildRequestContent(request));
            messages.push(`Wrote ${requestPath}`);
        }
    }

    /**
     * The Portfolio (Project) name of a full epic / portfolio epic record.
     * @param {object} full - Full record (or undefined when the cache is missing).
     * @returns {string}
     */
    portfolioName(full) {
        return full && full.Project && full.Project.Name ? full.Project.Name : UNASSIGNED_PORTFOLIO;
    }

    /**
     * Pull the members of a junction collection on one side that point at a given
     * Id on the other side, de-duplicated and name-sorted.
     * @param {Array<object>} mappings - The junction items.
     * @param {string} matchKey - The relation to match on ("AgileReleaseTrain" | "ValueStream").
     * @param {number} matchId - The Id that relation must equal.
     * @param {string} memberKey - The relation to return ("ValueStream" | "Epic" | "PortfolioEpic").
     * @returns {Array<object>} The matched member references ({ Id, Name }).
     */
    relatedMembers(mappings, matchKey, matchId, memberKey) {
        const seen = new Set();
        const members = [];
        for (const mapping of mappings) {
            if (!mapping[matchKey] || mapping[matchKey].Id !== matchId) {
                continue;
            }
            const member = mapping[memberKey];
            if (!member || seen.has(member.Id)) {
                continue;
            }
            seen.add(member.Id);
            members.push(member);
        }
        return members.sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)));
    }

    /**
     * Build a single value stream's detail page. Its epics and portfolio epics are
     * its child folders, so the page carries only the value stream's own detail.
     * @param {object} valueStream - Full record, or the {Id, Name} mapping ref.
     * @returns {string}
     */
    buildValueStreamHome(valueStream) {
        const description = this.htmlToText(valueStream.Description);

        const parts = [
            md.buildHero(valueStream.Name),
        ];

        if (description) {
            parts.push(description);
        }

        return parts.join('\n\n') + '\n';
    }

    /**
     * Build a Portfolio group page (the no-value-stream bucket under a train).
     * @param {string} name - The Portfolio (Project) name.
     * @returns {string}
     */
    buildPortfolioHome(name) {
        const parts = [
            md.buildHero(name),
            'Epics and portfolio epics on this release train that are not assigned to a value stream.',
        ];

        return parts.join('\n\n') + '\n';
    }

    /**
     * Build a single portfolio epic's detail page.
     * @param {object} portfolioEpic - Full record, or the {Id, Name} mapping ref.
     * @param {Array<object>} [features] - Features belonging to this portfolio epic.
     * @param {Array<object>} [requests] - Requests linked to this portfolio epic (Continuous Exploration).
     * @param {Array<object>} [requirements] - Requirements linked to this portfolio epic.
     * @returns {string}
     */
    buildPortfolioEpicHome(portfolioEpic, features = [], requests = [], requirements = []) {
        const description = this.htmlToText(portfolioEpic.Description);

        const parts = [
            md.buildHero(portfolioEpic.Name),
        ];

        if (description) {
            parts.push(description);
        }

        parts.push(...this.buildRequirementsSection(requirements));
        parts.push(...this.buildContinuousExplorationSection(requests));

        return parts.join('\n\n') + '\n';
    }
}

module.exports = ReleaseTrainsService;
