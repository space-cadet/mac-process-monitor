/**
 * Profile management UI — create, edit, delete monitoring profiles.
 */

let profiles = [];

function renderProfiles(container, onProfileClick) {
  clearEl(container);

  if (profiles.length === 0) {
    container.innerHTML = '<div class="empty">No profiles yet. Create one to monitor process groups.</div>';
    return;
  }

  for (const prof of profiles) {
    const card = createEl('div', 'profile-card');
    card.style.borderLeft = `4px solid ${prof.color || '#3b82f6'}`;
    card.innerHTML = `
      <div class="profile-header">
        <span class="profile-name">${prof.name}</span>
        <span class="profile-count">${prof.processes?.length || 0} processes</span>
      </div>
      <div class="profile-processes">${(prof.processes || []).join(', ')}</div>
      <div class="profile-actions">
        <button class="btn-edit" data-id="${prof.id}">Edit</button>
        <button class="btn-delete" data-id="${prof.id}">Delete</button>
      </div>
    `;

    card.querySelector('.profile-header').addEventListener('click', () => {
      if (onProfileClick) onProfileClick(prof);
    });

    card.querySelector('.btn-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      showProfileForm(prof);
    });

    card.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteProfile(prof.id, container, onProfileClick);
    });

    container.appendChild(card);
  }
}

function showProfileForm(existing = null) {
  const modal = document.getElementById('profile-modal');
  const title = document.getElementById('profile-form-title');
  const nameInput = document.getElementById('profile-name');
  const colorInput = document.getElementById('profile-color');
  const processesInput = document.getElementById('profile-processes');
  const idInput = document.getElementById('profile-id');

  title.textContent = existing ? 'Edit Profile' : 'New Profile';
  idInput.value = existing?.id || '';
  nameInput.value = existing?.name || '';
  colorInput.value = existing?.color || '#3b82f6';
  processesInput.value = (existing?.processes || []).join(', ');

  modal.classList.add('active');
}

function hideProfileForm() {
  document.getElementById('profile-modal').classList.remove('active');
}

async function saveProfileFromForm(container, onProfileClick) {
  const id = document.getElementById('profile-id').value || crypto.randomUUID();
  const name = document.getElementById('profile-name').value.trim();
  const color = document.getElementById('profile-color').value;
  const processes = document.getElementById('profile-processes').value
    .split(',')
    .map(s => s.trim())
    .filter(s => s);

  if (!name) {
    alert('Name is required');
    return;
  }

  try {
    await apiPost('/profiles', { id, name, color, processes });
    await loadProfiles(container, onProfileClick);
    hideProfileForm();
  } catch (err) {
    alert('Failed to save profile: ' + err.message);
  }
}

async function deleteProfile(id, container, onProfileClick) {
  if (!confirm('Delete this profile?')) return;
  try {
    await apiDelete('/profiles/' + id);
    await loadProfiles(container, onProfileClick);
  } catch (err) {
    alert('Failed to delete profile: ' + err.message);
  }
}

async function loadProfiles(container, onProfileClick) {
  try {
    profiles = await apiGet('/profiles');
    renderProfiles(container, onProfileClick);
  } catch (err) {
    console.error('Failed to load profiles:', err);
    container.innerHTML = '<div class="empty">Error loading profiles</div>';
  }
}
