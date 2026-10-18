/**
 * @fileoverview Tests for businessSolutionClass.
 *
 * Snapshots pin the generated markdown for each viewpoint builder so future
 * changes are reviewed deliberately. The markdown targets the KR custom-block
 * parser (hero-banner, container, accordion, summary blocks plus tables).
 */

'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Mock the graphic utility so create*Content methods never hit the network.
// The path must be the one businessSolution.js itself resolves — the shared
// common/architecture copy, not a per-group one.
jest.mock(
    '../../../workflows/common/architecture/models/graphic.js',
    () =>
        jest.fn().mockImplementation(() => ({
            retrievePNGDataCached: jest.fn().mockResolvedValue('BASE64PNG'),
        }))
);

const BusinessSolutionClass = require('../../../workflows/solution-design/services/businessSolution.js');

// A temporary datafolder is required by ModelBase's constructor.
const datafolder = path.join(os.tmpdir(), 'bs-characterization-test');
const settings = {
    datafolder,
    contentfolder: 'CONTENT',
    model: 'roadmap-1',
    server: 'aris.example',
    database: 'db',
    token: 'tok',
};

/** Rich fixture covering every attribute read by Home/BusinessSolution/NFR/Engineering. */
const solutionData = {
    attributes: {
        Name: 'PaymentHub - Business Solution',
        'Description/Definition': 'Handles all payment processing.',
        'Short Description': 'Payments',
        'Current Status': 'Active',
        'Future Strategy': 'Invest',
        'Pace Layer': 'Systems of Differentiation',
        'Business Owner': 'Jane Doe',
        'Responsible Technology Executive': 'Debbie Cunningham',
        'Technology HOD': 'John Smith',
        'Solution Architect': 'Alex Roe',
        'Application Type': 'Web',
        'Hosting Type': 'Cloud',
        Manufacturer: 'In-House',
        Abbreviation: 'PH',
        'Business Critical': 'Yes',
        'Solution Continuity Tier': 'Tier 1',
        'Solution Criticality Tier': 'Tier 1',
        MTTR: '4h',
        'DR Plan Available': 'Yes',
        'DR-Available': 'Yes',
        'DR Level': 'Hot',
        'Co-Existence': 'Required',
        Interoperability: 'High',
        Extensibility: 'Medium',
        'Monitoring and Support': '24/7',
        'Re-usability': 'High',
        'Minimum network bandwidth required': '10Mbps',
        'Network Quality of Service': 'Gold',
        'Network Quality of Service Internal WAN': 'Gold',
        'Peak messaging': '1000/s',
        'Peak time simultaneous users/ connections': '5000',
        'Projected solution usage growth': '20%',
        'Solution scalability required': 'Horizontal',
        'Storage space required': '500GB',
        Adaptability: 'High',
        Installability: 'Easy',
        Archiving: 'Yearly',
        'Backup Config': 'Daily',
        'Business Owner RPO/RTO': '1h/4h',
        'Data retention period': '7 years',
        'Down-time for servicing': 'Monthly',
        'Hours of operation': '24/7',
        Accountability: 'Audited',
        Authenticity: 'MFA',
        Confidentiality: 'High',
        Integrity: 'Checksums',
        'Legislation and Gov': 'POPIA',
        'Non-repudiation': 'Signed',
        Policies: 'Standard',
        Accessibility: 'WCAG AA',
        Localization: 'EN',
        'Usability constraints': 'None',
    },
    modelObjects: {},
};

/** Fixture for the table-builder methods (Principles/Compliance/CRUD/Capability/Context). */
const tableData = {
    attributes: { Name: 'PaymentHub - Capabilities' },
    modelObjects: {
        obj1: {
            attributes: {
                'Description/Definition': 'First object description.',
                'Security Classification': 'Confidential',
            },
            connections: [
                {
                    type: 'realizes',
                    srcmodelname: 'Source One',
                    targetmodelname: 'Target One',
                    attributes: {
                        'Principle Compliance': 'Full',
                        'Description/Definition': 'Connection one description.',
                    },
                },
            ],
        },
        obj2: {
            attributes: { 'Description/Definition': 'Object with no connections.' },
            connections: [],
        },
    },
};

/**
 * Fixture for an individual integration page (createIntegrationContent): one
 * Information carrier (Data Flow) carrying attributes across all four detail
 * sections, plus a non-carrier object that must be ignored.
 */
const integrationData = {
    attributes: { Name: 'PaymentHub - Known Integration' },
    modelObjects: {
        carrier1: {
            type: 'Information carrier',
            symbol: 'Data Flow',
            connections: [],
            attributes: {
                Name: 'ARIS00001',
                'Description/Definition': 'Fetch Data',
                Purpose: 'Provide data to consumer',
                'Technical Operation Name': '/fetch',
                'Project-Cross Ref No.': 'ARIS00001',
                'Integration Type': 'REST Webservice',
                'Communication Protocol': 'REST over HTTP',
                'Data Format': 'JSON',
                'API Flow Direction': 'Inbound',
                Synchronicity: 'Synchronous',
                'Batch or Real Time': 'Real Time',
                Frequency: 'Ad Hoc',
                'Estimated size of the data per message': '1KB - 2MB',
                'Security Classification': 'Confidential',
                'Required Security Mechanism': 'HTTPS',
                'Actual Security Mechanism': 'HTTPS',
                'Data Privacy': 'No',
                'PCI Related': 'No',
                'Finance or Pricing related': 'Yes',
                Monetised: 'false',
                'Requires guaranteed delivery': 'No',
                'Is transformation required': 'No',
                'Requires transformation reason': 'N/A',
                'Is the interface re-usable': 'Re-usable data between multiple systems',
                'Requires complex routing': 'No',
                'Requires complex transaction management': 'No',
                'Requires complex error management': 'No',
            },
        },
        app1: {
            type: 'Application system type',
            symbol: 'Application system type',
            connections: [],
            attributes: { Name: 'noobly Wiki' },
        },
    },
};

const makeBusinessSolution = () => new BusinessSolutionClass(settings);

beforeAll(() => {
    // Provide the cache file that filterBusinessSolution / determineFolder read.
    const cacheDir = path.join(datafolder, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
        path.join(cacheDir, 'businessSolutions.json'),
        JSON.stringify({
            modelObjects: {
                activeObj: {
                    assignments: [{ model: 'roadmap-1' }],
                    attributes: {
                        'Current Status': 'Active',
                        'Responsible Technology Executive': 'Debbie Cunningham',
                        'Value Stream - Sell': 'Principal',
                    },
                    connections: [
                        { type: 'belongs to class', targetmodelname: 'Retail Domain' },
                    ],
                },
                otherRoadmap: {
                    assignments: [{ model: 'roadmap-2' }],
                    attributes: { 'Current Status': 'Active' },
                    connections: [],
                },
            },
        })
    );
});

afterAll(() => {
    fs.rmSync(datafolder, { recursive: true, force: true });
});

describe('businessSolutionClass - determineModelPath', () => {
    // The folders argument is always determineFolder()'s output. Only portfolio
    // and valuestream reach the path — domain is carried but not used.
    const folders = {
        portfolio: 'Engineering Technologies',
        valuestream: 'Sell',
        domain: 'Retail Domain',
    };

    it('builds path parts from a "Name - ViewPoint" model name', () => {
        const bs = makeBusinessSolution();
        const result = bs.determineModelPath(
            { attributes: { Name: 'PaymentHub - Capabilities' } },
            folders
        );
        expect(result).toEqual({
            businessSolution: 'PaymentHub',
            viewPoint: 'Capabilities',
            folder: 'CONTENT/Engineering Technologies/Sell/PaymentHub/',
            filename:
                'CONTENT/Engineering Technologies/Sell/PaymentHub/Capabilities.md',
        });
    });

    it('nests the content under a version folder when one is supplied', () => {
        const bs = makeBusinessSolution();
        const result = bs.determineModelPath(
            { attributes: { Name: 'PaymentHub - Capabilities' } },
            folders,
            'To Be'
        );
        expect(result.folder).toBe('CONTENT/Engineering Technologies/Sell/PaymentHub/To Be/');
        expect(result.filename).toBe(
            'CONTENT/Engineering Technologies/Sell/PaymentHub/To Be/Capabilities.md'
        );
    });

    it('returns undefined when the model name cannot be parsed', () => {
        const bs = makeBusinessSolution();
        expect(bs.determineModelPath({ attributes: {} }, {})).toBeUndefined();
    });
});

describe('businessSolutionClass - filterBusinessSolution', () => {
    it('keeps only objects whose first assignment matches the roadmap', async () => {
        const bs = makeBusinessSolution();
        const result = await bs.filterBusinessSolution('roadmap-1');
        expect(Object.keys(result.modelObjects)).toEqual(['activeObj']);
    });
});

describe('businessSolutionClass - determineFolder', () => {
    it('derives portfolio, value stream and domain from the roadmap object', async () => {
        const bs = makeBusinessSolution();
        const folder = await bs.determineFolder('roadmap-1');
        expect(folder).toEqual({
            portfolio: 'Distribution',
            valuestream: 'Sell',
            domain: 'Retail Domain',
        });
    });
});

describe('businessSolutionClass - classifyViewpoint', () => {
    // These five used to fall through to 'placeholder' (diagram image only).
    // They now get their own builders — an object-by-object inventory accordion
    // — so they are matched BEFORE the placeholder catch.
    const cases = [
        ['PaymentHub - API Definition', 'apidefinition'],
        ['PaymentHub - Landscape', 'landscape'],
        ['PaymentHub - Solution Component', 'component'],
        ['PaymentHub - Technology Stack', 'techstack'],
        ['PaymentHub - Solution Positioning', 'positioning'],
        ['PaymentHub - Webhook Definition', 'placeholder'],
        ['PaymentHub - Message Publish Definition', 'placeholder'],
        ['PaymentHub - Capabilities', 'capability'],
        ['PaymentHub - Context', 'context'],
        ['PaymentHub - CRUD', 'crud'],
        ['PaymentHub - Solution Principles', 'principles'],
        ['PaymentHub - Solution Compliance', 'compliance'],
        ['PaymentHub - Compliance', 'compliance'],
        ['PaymentHub - Roadmap', 'roadmap'],
        ['PaymentHub - Reports', 'reports'],
        ['PaymentHub - Something Else', 'undefined'],
        ['PaymentHub', null],
    ];

    it.each(cases)('classifies "%s" as %s', (name, expected) => {
        expect(makeBusinessSolution().classifyViewpoint(name)).toBe(expected);
    });
});

describe('businessSolutionClass - content builders (snapshots)', () => {
    it('createHomeContent', async () => {
        const bs = makeBusinessSolution();
        const content = await bs.createHomeContent('roadmap-1', solutionData, [
            { name: 'Landscape', model: 'm-landscape' },
            { name: 'Capabilities', model: 'm-capabilities' },
        ]);
        expect(content).toMatchSnapshot();
    });

    it('createBusinessSolutionContent', async () => {
        const bs = makeBusinessSolution();
        const content = await bs.createBusinessSolutionContent('roadmap-1', solutionData, [
            { name: 'Solution Component', model: 'm-component' },
        ]);
        expect(content).toMatchSnapshot();
    });

    it('createNFRContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createNFRContent('roadmap-1', solutionData)).toMatchSnapshot();
    });

    it('createEngineeringContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createEngineeringContent('roadmap-1', solutionData)).toMatchSnapshot();
    });

    it('createPrinciplesContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createPrinciplesContent('m', tableData, 'folder')).toMatchSnapshot();
    });

    it('createComplianceContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createComplianceContent('m', tableData, 'folder')).toMatchSnapshot();
    });

    it('createCRUDContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createCRUDContent('m', tableData, 'folder')).toMatchSnapshot();
    });

    it('createCapabilityContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createCapabilityContent('m', tableData, 'folder')).toMatchSnapshot();
    });

    it('createContextContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createContextContent('m', tableData, 'folder')).toMatchSnapshot();
    });

    it('buildInfoCarrierDetails groups carrier attributes into captioned tables', () => {
        const bs = makeBusinessSolution();
        const details = bs.buildInfoCarrierDetails(integrationData.modelObjects.carrier1.attributes);
        // One bold caption per section, values plain (no inline-badge markup,
        // which custom blocks do not process).
        expect(details).toContain('**Overview**');
        expect(details).toContain('**Technical**');
        expect(details).toContain('**Security & Compliance**');
        expect(details).toContain('**Delivery & Design**');
        expect(details).toContain('| **Security Classification** | Confidential |');
        expect(details).not.toContain('[badge:');
    });

    it('createPlaceHolderContent', async () => {
        const bs = makeBusinessSolution();
        const content = await bs.createPlaceHolderContent(
            'm',
            { attributes: { Name: 'PaymentHub - Technology Stack' } },
            'folder'
        );
        expect(content).toMatchSnapshot();
    });

    it('createIntegrationContent', async () => {
        const bs = makeBusinessSolution();
        expect(await bs.createIntegrationContent('m', integrationData, 'folder')).toMatchSnapshot();
    });

    it('createIntegrationContent falls back to the graphic when there are no carriers', async () => {
        const bs = makeBusinessSolution();
        const content = await bs.createIntegrationContent(
            'm',
            {
                attributes: { Name: 'PaymentHub - Empty Integration' },
                modelObjects: {
                    app: { type: 'Application system type', connections: [], attributes: { Name: 'App' } },
                },
            },
            'folder'
        );
        expect(content).not.toContain('Integration Details');
        expect(content).toContain('![PaymentHub - Empty Integration]');
    });
});
