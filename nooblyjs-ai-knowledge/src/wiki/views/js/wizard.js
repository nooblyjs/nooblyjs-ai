/**
 * Setup Wizard Client-Side Logic
 * Handles space configuration for new users
 */

(function() {
    'use strict';

    let currentStep = 1;
    let spacesTemplate = null;
    let selectedSpaces = [];
    let availableSpaces = [];
    let selectedSpaceIds = [];

    // Initialize wizard on page load
    document.addEventListener('DOMContentLoaded', async () => {
        await checkWizardStatus();
        await loadAvailableSpaces();
        setupEventListeners();
    });

    /**
     * Check if user needs to complete wizard
     */
    async function checkWizardStatus() {
        try {
            console.log('[Wizard] Checking wizard status...');
            const response = await fetch('/applications/wiki/api/wizard/check', {
                credentials: 'include'
            });
            console.log('[Wizard] Check status response status:', response.status);
            const data = await response.json();
            console.log('[Wizard] Check status response data:', data);

            if (!data.needsWizard) {
                console.log('[Wizard] User has spaces, redirecting to wiki');
                // User already has spaces, send them to wiki
                window.location.href = '/applications/wiki';
                return;
            }
            console.log('[Wizard] User needs wizard, proceeding with setup');
        } catch (error) {
            console.error('[Wizard] Error checking wizard status:', error);
        }
    }

    /**
     * Load available public and team spaces that user can join
     */
    async function loadAvailableSpaces() {
        try {
            console.log('[Wizard] Loading available spaces...');
            const response = await fetch('/applications/wiki/api/wizard/available-spaces', {
                credentials: 'include'
            });
            console.log('[Wizard] Available spaces response status:', response.status);
            const data = await response.json();
            console.log('[Wizard] Available spaces response data:', data);

            if (data.success) {
                availableSpaces = data.spaces;
                console.log('[Wizard] Found', availableSpaces.length, 'available spaces');
                renderAvailableSpacesCards();

                // Show message if no spaces available
                if (availableSpaces.length === 0) {
                    console.log('[Wizard] No spaces available, showing empty message');
                    document.getElementById('noSpacesMessage').classList.remove('d-none');
                }
            } else {
                console.error('[Wizard] API returned success=false:', data);
            }
        } catch (error) {
            console.error('[Wizard] Error loading available spaces:', error);
            // Don't show error, just continue with empty spaces
            document.getElementById('noSpacesMessage').classList.remove('d-none');
        }
    }

    /**
     * Render available spaces as selection cards
     */
    function renderAvailableSpacesCards() {
        const container = document.getElementById('availableSpacesContainer');
        container.innerHTML = '';

        availableSpaces.forEach(space => {
            const card = createAvailableSpaceCard(space);
            container.appendChild(card);
        });
    }

    /**
     * Create card for selecting existing space
     */
    function createAvailableSpaceCard(space) {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4';

        const isSelected = selectedSpaceIds.includes(space.id);
        const visibilityBadgeClass = space.visibility === 'public' ? 'bg-success' : 'bg-info';

        col.innerHTML = `
            <div class="card h-100 ${isSelected ? 'border-primary border-2' : 'border-light'} cursor-pointer"
                 data-space-id="${space.id}"
                 style="transition: all 0.3s ease;">
                <div class="card-body">
                    <div class="form-check mb-2">
                        <input class="form-check-input space-checkbox" type="checkbox"
                               id="space-${space.id}" ${isSelected ? 'checked' : ''}>
                        <label class="form-check-label fw-bold ms-1" for="space-${space.id}">
                            ${space.name}
                        </label>
                    </div>
                    <p class="card-text small text-muted mb-2">${space.description || 'No description'}</p>
                    <div class="d-flex gap-2">
                        <span class="badge ${visibilityBadgeClass}">${space.visibility}</span>
                        <span class="badge bg-secondary">${space.type || 'workspace'}</span>
                    </div>
                </div>
            </div>
        `;

        const checkbox = col.querySelector('.form-check-input');
        checkbox.addEventListener('change', (e) => {
            handleAvailableSpaceSelection(space.id, e.target.checked);
            col.classList.toggle('border-primary');
            col.classList.toggle('border-2');
            col.classList.toggle('border-light');
        });

        return col;
    }

    /**
     * Handle available space selection
     */
    function handleAvailableSpaceSelection(spaceId, isSelected) {
        console.log('[Wizard] Space selection changed - Space ID:', spaceId, 'Selected:', isSelected);
        if (isSelected) {
            if (!selectedSpaceIds.includes(spaceId)) {
                selectedSpaceIds.push(spaceId);
            }
        } else {
            const index = selectedSpaceIds.indexOf(spaceId);
            if (index > -1) {
                selectedSpaceIds.splice(index, 1);
            }
        }
        console.log('[Wizard] Currently selected space IDs:', selectedSpaceIds);
    }

    /**
     * Load spaces configuration template (legacy - kept for backward compatibility)
     */
    async function loadSpacesConfig() {
        try {
            const response = await fetch('/applications/wiki/api/wizard/config', {
                credentials: 'include'
            });
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
            // Don't show error for legacy template loading
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
        // Initialize button - completes wizard with selected spaces
        document.getElementById('initializeBtn').addEventListener('click', async () => {
            await handleCompleteWizard();
        });

        // Create private space button
        document.getElementById('createPrivateBtn').addEventListener('click', async () => {
            await handleCreatePrivateSpace();
        });

        // Skip wizard button
        const skipBtn = document.getElementById('skipWizardBtn');
        if (skipBtn) {
            skipBtn.addEventListener('click', async () => {
                await handleSkipWizard();
            });
        }

        // Go to wiki button
        document.getElementById('goToWikiBtn').addEventListener('click', () => {
            window.location.href = '/applications/wiki';
        });
    }

    /**
     * Handle creating a private space
     */
    async function handleCreatePrivateSpace() {
        const nameInput = document.getElementById('privateSpaceName');
        const descInput = document.getElementById('privateSpaceDesc');
        const templateCheckbox = document.getElementById('useTemplateCheckbox');

        const name = nameInput.value.trim();
        const description = descInput.value.trim();
        const useTemplate = templateCheckbox.checked;

        if (!name) {
            showError('privateSpaceError', 'Please enter a space name');
            return;
        }

        hideError('privateSpaceError');
        showLoading(true);

        try {
            const response = await fetch('/applications/wiki/api/wizard/create-private', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name,
                    description,
                    useTemplate,
                    templateId: 'personal'
                })
            });

            const data = await response.json();
            showLoading(false);

            if (response.ok && data.success) {
                // Add created space to selected spaces
                selectedSpaceIds.push(data.space.id);

                // Clear form
                nameInput.value = '';
                descInput.value = '';

                // Show success
                const successAlert = document.createElement('div');
                successAlert.className = 'alert alert-success alert-dismissible fade show mt-3';
                successAlert.innerHTML = `
                    <i class="bi bi-check-circle me-2"></i>
                    Private space "<strong>${data.space.name}</strong>" created successfully!
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                `;
                document.querySelector('#privateSpaceDesc').parentElement.parentElement.parentElement.appendChild(successAlert);

                // Auto-dismiss after 3 seconds
                setTimeout(() => {
                    const alert = successAlert.parentElement?.querySelector('.alert-success');
                    if (alert) alert.remove();
                }, 3000);
            } else {
                showError('privateSpaceError', data.error || 'Failed to create private space');
            }
        } catch (error) {
            console.error('Error creating private space:', error);
            showLoading(false);
            showError('privateSpaceError', 'An error occurred. Please try again.');
        }
    }

    /**
     * Handle completing wizard - add user to selected spaces and go to wiki
     */
    async function handleCompleteWizard() {
        console.log('[Wizard] Complete setup clicked');
        console.log('[Wizard] Selected space IDs:', selectedSpaceIds);

        if (selectedSpaceIds.length === 0) {
            console.log('[Wizard] No spaces selected - showing error');
            showError('spacesError', 'Please select at least one space or create a private space');
            return;
        }

        hideError('spacesError');
        showLoading(true);

        try {
            // Add user to selected spaces
            console.log('[Wizard] Adding user to', selectedSpaceIds.length, 'spaces...');
            const response = await fetch('/applications/wiki/api/wizard/select-spaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ spaceIds: selectedSpaceIds })
            });

            const data = await response.json();
            console.log('[Wizard] Spaces updated:', data);

            if (!response.ok || !data.success) {
                showLoading(false);
                console.error('[Wizard] Failed to save selections:', data.error);
                showError('spacesError', data.error || 'Failed to save space selections');
                return;
            }

            showLoading(false);
            console.log('[Wizard] Redirecting to wiki...');
            // User now has spaces, so redirect to wiki
            window.location.href = '/applications/wiki';
        } catch (error) {
            console.error('[Wizard] Error completing wizard:', error);
            showLoading(false);
            showError('spacesError', 'An error occurred. Please try again.');
        }
    }

    /**
     * Handle skipping wizard - redirect to wiki
     * If user has no spaces, they'll see wizard again on next login
     */
    async function handleSkipWizard() {
        if (confirm('Skip setup? You\'ll need to join spaces to use the wiki.')) {
            console.log('[Wizard] Redirecting to wiki...');
            window.location.href = '/applications/wiki';
        }
    }

    /**
     * Handle wiki initialization (legacy - kept for backward compatibility)
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
                credentials: 'include',
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
