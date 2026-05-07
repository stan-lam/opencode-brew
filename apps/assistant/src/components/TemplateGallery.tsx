import { useState } from 'react';
import { X } from 'lucide-react';
import { templates, templateCategories, AgentTemplate, TemplateCategory } from '../templates';
import styles from './TemplateGallery.module.css';

interface TemplateGalleryProps {
  onClose: () => void;
  onSelectTemplate: (template: AgentTemplate) => void;
}

export function TemplateGallery({ onClose, onSelectTemplate }: TemplateGalleryProps) {
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'all'>('all');

  const filteredTemplates = selectedCategory === 'all'
    ? templates
    : templates.filter(t => t.category === selectedCategory);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Create from Template</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.categories}>
            <button
              className={`${styles.categoryBtn} ${selectedCategory === 'all' ? styles.active : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              <span className={styles.categoryIcon}>🎯</span>
              All Templates
            </button>
            {templateCategories.map(category => {
              const count = templates.filter(t => t.category === category.id).length;
              if (count === 0) return null;
              return (
                <button
                  key={category.id}
                  className={`${styles.categoryBtn} ${selectedCategory === category.id ? styles.active : ''}`}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <span className={styles.categoryIcon}>{category.icon}</span>
                  {category.name}
                </button>
              );
            })}
          </div>

          {filteredTemplates.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>📭</div>
              <p className={styles.emptyText}>No templates in this category yet</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredTemplates.map(template => (
                <div
                  key={template.id}
                  className={styles.templateCard}
                  onClick={() => onSelectTemplate(template)}
                >
                  <div className={styles.templateIcon}>{template.icon}</div>
                  <div className={styles.templateName}>{template.name}</div>
                  <div className={styles.templateDescription}>{template.description}</div>
                  {template.tags && template.tags.length > 0 && (
                    <div className={styles.templateTags}>
                      {template.tags.slice(0, 3).map(tag => (
                        <span key={tag} className={styles.tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TemplateGallery;
