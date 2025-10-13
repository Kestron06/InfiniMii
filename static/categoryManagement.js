// Category Management Functions

async function addParentCategory() {
    const name = document.getElementById('newParentName').value.trim();
    const color = document.getElementById('newParentColor').value;
    
    if (!name) {
        alert('Please enter a category name');
        return;
    }
    
    try {
        const response = await fetch('/addParentCategory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color })
        });
        
        const data = await response.json();
        
        if (data.okay) {
            alert('Parent category created successfully!');
            location.reload();
        } else {
            alert('Error: ' + (data.error || 'Failed to create category'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error creating category');
    }
}

async function addSubcategory(parentCategory) {
    const inputId = 'newSub_' + parentCategory.replace(/\s+/g, '_');
    const subcategoryName = document.getElementById(inputId).value.trim();
    
    if (!subcategoryName) {
        alert('Please enter a subcategory name');
        return;
    }
    
    try {
        const response = await fetch('/addSubcategory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentCategory, subcategoryName })
        });
        
        const data = await response.json();
        
        if (data.okay) {
            alert('Subcategory created successfully!');
            location.reload();
        } else {
            alert('Error: ' + (data.error || 'Failed to create subcategory'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error creating subcategory');
    }
}

async function renameParentCategory(oldName) {
    const newName = prompt('Enter new name for category:', oldName);
    
    if (!newName || newName === oldName) return;
    
    try {
        const response = await fetch('/renameParentCategory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName, newName })
        });
        
        const data = await response.json();
        
        if (data.okay) {
            alert('Category renamed successfully!');
            location.reload();
        } else {
            alert('Error: ' + (data.error || 'Failed to rename category'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error renaming category');
    }
}

async function renameSubcategory(parentCategory, oldName) {
    const newName = prompt('Enter new name for subcategory:', oldName);
    
    if (!newName || newName === oldName) return;
    
    const confirmed = confirm(
        `This will rename "${oldName}" to "${newName}" and update all Miis using this category.\n\nContinue?`
    );
    
    if (!confirmed) return;
    
    try {
        const response = await fetch('/renameSubcategory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentCategory, oldName, newName })
        });
        
        const data = await response.json();
        
        if (data.okay) {
            alert(`Subcategory renamed successfully!\n${data.updatedMiis} Miis were updated.`);
            location.reload();
        } else {
            alert('Error: ' + (data.error || 'Failed to rename subcategory'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error renaming subcategory');
    }
}

async function deleteSubcategory(parentCategory, subcategoryName) {
    const confirmed = confirm(
        `Delete subcategory "${subcategoryName}"?\n\nThis will remove it from all Miis using it. This cannot be undone.`
    );
    
    if (!confirmed) return;
    
    try {
        const response = await fetch('/deleteSubcategory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentCategory, subcategoryName })
        });
        
        const data = await response.json();
        
        if (data.okay) {
            alert(`Subcategory deleted successfully!\n${data.updatedMiis} Miis were updated.`);
            location.reload();
        } else {
            alert('Error: ' + (data.error || 'Failed to delete subcategory'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error deleting subcategory');
    }
}

async function deleteParentCategory(name) {
    const confirmed = confirm(
        `Delete parent category "${name}" and ALL its subcategories?\n\nThis will remove all subcategories from all Miis. This cannot be undone.`
    );
    
    if (!confirmed) return;
    
    const doubleConfirmed = confirm(
        `Are you ABSOLUTELY sure? This is a destructive action.`
    );
    
    if (!doubleConfirmed) return;
    
    try {
        const response = await fetch('/deleteParentCategory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        const data = await response.json();
        
        if (data.okay) {
            alert(`Parent category deleted successfully!\n${data.updatedMiis} Miis were updated.`);
            location.reload();
        } else {
            alert('Error: ' + (data.error || 'Failed to delete category'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error deleting category');
    }
}