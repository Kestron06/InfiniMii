function switchTab(tab) {
    // Update buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');
}
let officialCategoriesStudio = [];
let selectedPathsStudio = new Set();
let expandedNodesStudio = new Set();

function toggleOfficialFieldsStudio() {
    const checkbox = document.getElementById('officialCheckboxStudio');
    const fields = document.getElementById('officialFieldsStudio');
    fields.style.display = checkbox.checked ? 'block' : 'none';
    
    if (checkbox.checked && officialCategoriesStudio.length === 0) {
        loadCategoriesStudio();
    }
}

async function loadCategoriesStudio() {
    try {
        const response = await fetch('/getOfficialCategories');
        const data = await response.json();
        
        if (data.okay) {
            officialCategoriesStudio = data.categories;
            renderCategoryTreeStudio();
        } else {
            document.getElementById('categoriesContainerStudio').innerHTML = 
                '<p style="color: red;">Error loading categories</p>';
        }
    } catch (error) {
        console.error('Error loading categories:', error);
        document.getElementById('categoriesContainerStudio').innerHTML = 
            '<p style="color: red;">Error loading categories</p>';
    }
}

function renderCategoryTreeStudio() {
    const container = document.getElementById('categoriesContainerStudio');
    
    if (officialCategoriesStudio.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666;">No categories available. <a href="/manageCategories" target="_blank">Create some!</a></p>';
        return;
    }
    
    container.innerHTML = '<div class="category-tree-upload">' + renderCategoryNodesStudio(officialCategoriesStudio) + '</div>';
}

function renderCategoryNodesStudio(nodes, level = 0) {
    let html = '';
    
    nodes.forEach(node => {
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = expandedNodesStudio.has(node.path);
        const isLeaf = !hasChildren;
        const isSelected = selectedPathsStudio.has(node.path);
        const indent = level * 20;
        
        html += `
            <div class="tree-node-upload" style="margin-left: ${indent}px;">
                <div class="node-line" style="border-left: 3px solid ${node.color}">
                    ${hasChildren ? `
                        <span class="toggle-upload" onclick="toggleNodeStudio('${node.path}')">
                            ${isExpanded ? '▼' : '▶'}
                        </span>
                    ` : '<span class="leaf-marker">•</span>'}
                    
                    ${isLeaf ? `
                        <label class="category-label-upload">
                            <input type="checkbox" 
                                name="categories" 
                                value="${node.path}"
                                ${isSelected ? 'checked' : ''}
                                onchange="updateSelectionStudio('${node.path}', this.checked)">
                            <span style="color: ${node.color}; font-weight: 500;">${node.name}</span>
                        </label>
                    ` : `
                        <span class="parent-name" style="color: ${node.color}; font-weight: 600;">
                            ${node.name}
                        </span>
                    `}
                </div>
                
                ${hasChildren && isExpanded ? `
                    <div class="children-upload">
                        ${renderCategoryNodesStudio(node.children, level + 1)}
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    return html;
}

function toggleNodeStudio(path) {
    if (expandedNodesStudio.has(path)) {
        expandedNodesStudio.delete(path);
    } else {
        expandedNodesStudio.add(path);
    }
    renderCategoryTreeStudio();
}

function updateSelectionStudio(path, checked) {
    if (checked) {
        selectedPathsStudio.add(path);
    } else {
        selectedPathsStudio.delete(path);
    }
}