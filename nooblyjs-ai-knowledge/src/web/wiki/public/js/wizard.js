/**
 * Setup Wizard Client-Side Logic
 * Handles space configuration for new users
 */

(function() {
    'use strict';

    let currentStep = 1;
    let spacesTemplate = null;
    let selectedSpaces = [];

    // Initialize wizard on page load
    document.addEventListener('DOMContentLoaded', async () => {
        await checkWizardStatus();
        await loadSpacesConfig();
        setupEventListeners();
    });

    /**
     * Check if user needs to complete wizard
     */
    async function checkWizardStatus() {
        try {
            const response = await fetch('/applications/wiki/api/wizard/check');
            const data = await response.json();

            if (!data.needsWizard) {
                // User has already completed wizard, redirect to main app
                window.location.href = '/';
                return;
            }
        } catch (error) {
            console.error('Error checking wizard status:', error);
        }
    }

    /**
     * Load spaces configuration template
     */
    async function loadSpacesConfig() {
        try {
            const response = await fetch('/applications/wiki/api/wizard/config');
            spacesTemplate = await response.json();

            // Pre-select all spaces by default
            selectedSpaces = spacesTemplate.spaces.map(space => ({
                id: space.id,
                path: space.defaultPath,
                selected: true
            }));

            renderSpacesCards();
        } catch (error) {
            console.error('Error loading spaces config:', error);
            showError('spacesError', 'Failed to load space configuration');
        }
    }

    /**
     * Render space selection cards
     */
    function renderSpacesCards() {
        const container = document.getElementById('spacesContainer');
        container.innerHTML = '';

        spacesTemplate.spaces.forEach(space => {
            const selected = selectedSpaces.find(s => s.id === space.id);
            const spaceCard = createSpaceCard(space, selected);
            container.appendChild(spaceCard);
        });
    }

    /**
     * Create a space card element using Bootstrap 5
     */
    function createSpaceCard(space, selectedConfig) {
        const col = document.createElement('div');
        col.className = 'col-12';

        const card = document.createElement('div');
        card.className = `card h-100 ${selectedConfig?.selected ? 'border-primary' : ''}`;
        card.style.cursor = 'pointer';
        card.dataset.spaceId = space.id;

        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex align-items-start">
                    <div class="form-check me-3">
                        <input class="form-check-input space-checkbox" type="checkbox"
                               id="space-${space.id}" ${selectedConfig?.selected ? 'checked' : ''}>
                    </div>
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-3">
                            <span class="fs-1 me-3">${space.icon}</span>
                            <div>
                                <h5 class="card-title mb-1">${space.name}</h5>
                                <p class="card-text text-muted mb-0 small">${space.description}</p>
                            </div>
                        </div>
                        <div class="d-flex gap-3 mb-3 small text-muted">
                            <span><i class="bi bi-eye me-1"></i>${space.visibility}</span>
                            <span><i class="bi bi-shield me-1"></i>${space.permissions}</span>
                            <span><i class="bi bi-folder me-1"></i>${space.folders.length} folders</span>
                        </div>
                        <div class="folder-path-section ${selectedConfig?.selected ? '' : 'd-none'}">
                            <label class="form-label small mb-1">Folder Location</label>
                            <div class="input-group">
                                <input type="text" class="form-control space-path"
                                       value="${selectedConfig?.path || space.defaultPath}"
                                       placeholder="Enter folder path">
                                <button class="btn btn-outline-secondary browse-btn" type="button" title="Browse">
                                    <i class="bi bi-folder2-open"></i>
                                </button>
                            </div>
                            <small class="form-text text-muted">Default: ${space.defaultPath}</small>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Event listener for checkbox
        const checkbox = card.querySelector('.space-checkbox');
        checkbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const folderSection = card.querySelector('.folder-path-section');

            if (isChecked) {
                card.classList.add('border-primary');
                folderSection.classList.remove('d-none');
                updateSelectedSpace(space.id, true, space.defaultPath);
            } else {
                card.classList.remove('border-primary');
                folderSection.classList.add('d-none');
                updateSelectedSpace(space.id, false);
            }
        });

        // Event listener for path input
        const pathInput = card.querySelector('.space-path');
        pathInput.addEventListener('change', (e) => {
            updateSelectedSpace(space.id, true, e.target.value);
        });

        // Browse button (placeholder)
        const browseBtn = card.querySelector('.browse-btn');
        browseBtn.addEventListener('click', () => {
            alert('Folder browser not implemented. Please enter the path manually.');
        });

        col.appendChild(card);
        return col;
    }

    /**
     * Update selected space configuration
     */
    function updateSelectedSpace(spaceId, selected, path = null) {
        const index = selectedSpaces.findIndex(s => s.id === spaceId);

        if (selected) {
            if (index === -1) {
                selectedSpaces.push({ id: spaceId, path, selected: true });
            } else {
                selectedSpaces[index].selected = true;
                if (path) selectedSpaces[index].path = path;
            }
        } else {
            if (index !== -1) {
                selectedSpaces[index].selected = false;
            }
        }
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Initialize button
        document.getElementById('initializeBtn').addEventListener('click', async () => {
            await handleInitialize();
        });

        // Go to wiki button
        document.getElementById('goToWikiBtn').addEventListener('click', () => {
            window.location.href = '/applications/wiki';
        });
    }

    /**
     * Handle wiki initialization
     */
    async function handleInitialize() {
        const activeSpaces = selectedSpaces.filter(s => s.selected);

        if (activeSpaces.length === 0) {
            showError('spacesError', 'Please select at least one space');
            return;
        }

        // Validate paths
        for (const space of activeSpaces) {
            if (!space.path || space.path.trim() === '') {
                showError('spacesError', 'Please provide a path for all selected spaces');
                return;
            }
        }

        hideError('spacesError');
        showLoading(true);

        try {
            const response = await fetch('/applications/wiki/api/wizard/initialize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    spaces: activeSpaces.map(s => ({ id: s.id, path: s.path }))
                })
            });

            const data = await response.json();

            if (!response.ok) {
                showLoading(false);
                showError('spacesError', data.error || 'Failed to initialize wiki');
                return;
            }

            // Update completion step with results
            document.getElementById('createdSpacesCount').textContent = data.spaces.length;
            document.getElementById('createdDocsCount').textContent = data.documentCount;

            showLoading(false);
            goToStep(2);
        } catch (error) {
            console.error('Error initializing wiki:', error);
            showLoading(false);
            showError('spacesError', 'An error occurred. Please try again.');
        }
    }

    /**
     * Navigate to a specific step
     */
    function goToStep(step) {
        // Hide all steps
        document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('d-none'));

        currentStep = step;

        if (step === 1) {
            document.getElementById('spacesStep').classList.remove('d-none');
            document.getElementById('step1').className = 'rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center';
            document.getElementById('step2').className = 'rounded-circle border border-2 border-secondary text-secondary d-flex align-items-center justify-content-center';
        } else if (step === 2) {
            document.getElementById('completionStep').classList.remove('d-none');
            document.getElementById('step1').className = 'rounded-circle bg-success text-white d-flex align-items-center justify-content-center';
            document.getElementById('step2').className = 'rounded-circle bg-success text-white d-flex align-items-center justify-content-center';
        }

        // Scroll to top
        window.scrollTo(0, 0);
    }

    /**
     * Show loading overlay
     */
    function showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        const spacesStep = document.getElementById('spacesStep');

        if (show) {
            overlay.classList.remove('d-none');
            spacesStep.style.opacity = '0.5';
            spacesStep.style.pointerEvents = 'none';
        } else {
            overlay.classList.add('d-none');
            spacesStep.style.opacity = '1';
            spacesStep.style.pointerEvents = 'auto';
        }
    }

    /**
     * Show error message
     */
    function showError(elementId, message) {
        const errorEl = document.getElementById(elementId);
        errorEl.textContent = message;
        errorEl.classList.remove('d-none');
    }

    /**
     * Hide error message
     */
    function hideError(elementId) {
        const errorEl = document.getElementById(elementId);
        errorEl.classList.add('d-none');
    }

})();
