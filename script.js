class CircularList {
    constructor(containerId, options = {}) {
        // Configuration
        this.isInfinite = options.infinite || false
        this.perspective = options.perspective || 1000
        this.cylinder3D = options.cylinder3D || false
        this.cylinderRadius = options.cylinderRadius || 250
        this.setResistance(options.resistance !== undefined ? options.resistance : 1.0)
        this.submitOnSelect = options.submitOnSelect !== false
        this.formInputName = options.formInputName || null


        // Physics constants
        this.SNAP_THRESHOLD = 1.0
        this.DRAG_SENSITIVITY = 1.0
        this.DRAG_RESISTANCE_DISTANCE = 2.0

        // Velocity calculation constants
        this.VELOCITY_TIME_MULTIPLIER = 16
        this.CURVE_STRENGTH_MULTIPLIER = 4
        this.MIN_RESISTANCE = 0.02

        // Animation constants
        this.ANIMATION_SNAP_SPEED = 0.15
        this.ANIMATION_THRESHOLD = 0.1

        // 3D rendering constants
        this.MIN_OPACITY = 0.3
        this.MIN_SCALE = 0.8
        this.SCALE_FACTOR = 0.2
        this.CYLINDER_HEIGHT_MULTIPLIER = 2

        // DOM elements and layout
        this.container = document.getElementById(containerId)
        this.originalItems = Array.from(this.container.children)
        this.baseItemCount = this.originalItems.length
        this.itemHeight = this.calculateItemHeight()

        this.createVirtualItems()
        this.items = Array.from(this.container.children)
        this.itemCount = this.items.length

        // State
        this.currentOffset = 0
        this.targetOffset = undefined
        this.isDragging = false
        this.velocity = 0
        this.lastY = 0
        this.lastTime = 0
        this.animationFrameId = null
        this.isSnapping = false
        this.logicalIndex = 0
        this.hiddenInput = null

        this.init()
    }

    // Initialization and setup methods
    init() {
        this.setupAccessibility()
        this.setupEventListeners()
        this.setupFormIntegration()
        this.setInfiniteMode(this.isInfinite)
        if (this.isInfinite) {
            this.handleInfiniteWrap()
        }
        this.setCylinder3D(this.cylinder3D)
        this.updatePositions()
        this.updateSelection()
    }

    setupAccessibility() {
        this.container.setAttribute('role', 'listbox')
        this.container.setAttribute('aria-label', 'Circular list selection')
        this.container.setAttribute('aria-orientation', 'vertical')
        this.updateItemsAccessibility()
    }

    updateItemsAccessibility() {
        this.items.forEach((item, index) => {
            item.setAttribute('role', 'option')
            item.setAttribute('aria-setsize', this.baseItemCount.toString())

            const logicalIndex = this.isInfinite ? index % this.baseItemCount : index
            item.setAttribute('aria-posinset', (logicalIndex + 1).toString())
        })
    }

    setupEventListeners() {
        this.container.addEventListener("mousedown", this.startDrag.bind(this))
        document.addEventListener("mousemove", this.drag.bind(this))
        document.addEventListener("mouseup", this.endDrag.bind(this))
        this.container.addEventListener("touchstart", this.startDrag.bind(this), { passive: false })
        document.addEventListener("touchmove", this.drag.bind(this), { passive: false })
        document.addEventListener("touchend", this.endDrag.bind(this))
        this.container.addEventListener("contextmenu", (e) => e.preventDefault())
        this.container.addEventListener("keydown", this.handleKeydown.bind(this))
        this.container.addEventListener("click", () => this.container.focus())
        window.addEventListener("resize", this.handleResize.bind(this))

        if (!this.container.hasAttribute('tabindex')) {
            this.container.setAttribute('tabindex', '0')
        }
    }

    setupFormIntegration() {
        if (this.formInputName) {
            this.hiddenInput = document.createElement('input')
            this.hiddenInput.type = 'hidden'
            this.hiddenInput.name = this.formInputName
            this.hiddenInput.value = this.getSelectedValue() || ''
            this.container.parentNode.insertBefore(this.hiddenInput, this.container.nextSibling)
        }
    }

    updateHiddenInput() {
        if (this.hiddenInput) {
            this.hiddenInput.value = this.getSelectedValue() || ''
        }
    }

    // Calculation methods
    calculateItemHeight() {
        if (this.originalItems.length === 0) return 54

        const tempItem = this.originalItems[0].cloneNode(true)
        tempItem.style.visibility = 'hidden'
        tempItem.style.position = 'absolute'
        this.container.appendChild(tempItem)

        const computedStyle = window.getComputedStyle(tempItem)
        const height = tempItem.offsetHeight +
            parseFloat(computedStyle.marginTop) +
            parseFloat(computedStyle.marginBottom)

        this.container.removeChild(tempItem)
        return height
    }

    calculateOptimalCopies() {
        const containerHeight = this.container.offsetHeight
        const itemsNeededToFillContainer = Math.ceil(containerHeight / this.itemHeight)
        const bufferCopies = 4
        const minItemsNeeded = itemsNeededToFillContainer * 3 + (bufferCopies * this.baseItemCount)
        const minCopiesNeeded = Math.ceil(minItemsNeeded / this.baseItemCount)

        return Math.max(5, minCopiesNeeded % 2 === 0 ? minCopiesNeeded + 1 : minCopiesNeeded)
    }

    createVirtualItems() {
        this.container.innerHTML = ""

        if (this.isInfinite) {
            this.totalCopies = this.calculateOptimalCopies()
            this.middleCopyIndex = Math.floor(this.totalCopies / 2)

            for (let copy = 0; copy < this.totalCopies; copy++) {
                this.originalItems.forEach((item) => {
                    const clonedItem = item.cloneNode(true)
                    clonedItem.classList.add(`copy-${copy}`)
                    this.container.appendChild(clonedItem)
                })
            }

            this.currentOffset = -this.middleCopyIndex * this.baseItemCount * this.itemHeight
        } else {
            this.originalItems.forEach((item) => {
                this.container.appendChild(item.cloneNode(true))
            })
            this.currentOffset = 0
        }

        this.items = Array.from(this.container.children)
        this.itemCount = this.items.length
        this.updateItemsAccessibility()
    }

    getBounds() {
        return {
            min: -(this.baseItemCount - 1) * this.itemHeight,
            max: 0
        }
    }

    getCurrentLogicalIndex() {
        if (this.isInfinite) {
            const middleCopyOffset = this.currentOffset + this.middleCopyIndex * this.baseItemCount * this.itemHeight
            const rawIndex = Math.round(-middleCopyOffset / this.itemHeight)
            return ((rawIndex % this.baseItemCount) + this.baseItemCount) % this.baseItemCount
        }
        const rawIndex = Math.round(-this.currentOffset / this.itemHeight)
        return Math.max(0, Math.min(this.baseItemCount - 1, rawIndex))
    }

    getValueAtLogicalIndex(logicalIndex) {
        const items = this.isInfinite ? this.originalItems : this.items
        return items[logicalIndex]?.dataset.value || items[logicalIndex]?.textContent
    }

    getEventY(event) {
        return event.type.includes("touch")
            ? event.touches[0]?.clientY || event.changedTouches[0]?.clientY
            : event.clientY
    }

    isOutOfBounds() {
        if (this.isInfinite) return false
        const bounds = this.getBounds()
        return this.currentOffset > bounds.max || this.currentOffset < bounds.min
    }

    // Event handlers
    handleResize() {
        this.updatePositions()
    }

    handleKeydown(event) {
        if (document.activeElement !== this.container) return

        const currentIndex = this.getSelectedIndex()

        switch (event.key) {
            case 'ArrowUp':
            case 'ArrowLeft':
                event.preventDefault()
                if (this.isInfinite) {
                    this.moveByOffset(1)
                } else {
                    this.selectItem(Math.max(0, currentIndex - 1))
                }
                break

            case 'ArrowDown':
            case 'ArrowRight':
                event.preventDefault()
                if (this.isInfinite) {
                    this.moveByOffset(-1)
                } else {
                    this.selectItem(Math.min(this.baseItemCount - 1, currentIndex + 1))
                }
                break

            case 'Home':
                event.preventDefault()
                this.selectItem(0)
                break

            case 'End':
                event.preventDefault()
                this.selectItem(this.baseItemCount - 1)
                break

            case 'PageUp':
                event.preventDefault()
                const pageUpSteps = Math.max(Math.min(this.baseItemCount, 2), Math.floor(this.baseItemCount / 3))
                if (this.isInfinite) {
                    this.moveByOffset(pageUpSteps)
                } else {
                    this.selectItem(Math.max(0, currentIndex - pageUpSteps))
                }
                break

            case 'PageDown':
                event.preventDefault()
                const pageDownSteps = Math.max(1, Math.floor(this.baseItemCount / 4))
                if (this.isInfinite) {
                    this.moveByOffset(-pageDownSteps)
                } else {
                    this.selectItem(Math.min(this.baseItemCount - 1, currentIndex + pageDownSteps))
                }
                break

            case ' ':
            case 'Enter':
                event.preventDefault()
                this.dispatchSelectionEvent()
                this.container.blur()

                if (this.submitOnSelect) {
                    const form = this.container.closest('form')
                    if (form) {
                        form.requestSubmit()
                    }
                }
                break

            case 'Escape':
                event.preventDefault()
                this.container.blur()
                break

            default:
                if (event.key.length === 1 && /[a-zA-Z0-9]/.test(event.key) &&
                    !event.ctrlKey && !event.metaKey && !event.altKey) {
                    event.preventDefault()
                    this.handleQuickSelection(event.key.toLowerCase())
                }
                break
        }
    }

    handleQuickSelection(key) {
        const items = this.isInfinite ? this.originalItems : this.items
        for (let i = 0; i < this.baseItemCount; i++) {
            const itemText = (items[i]?.dataset.value || items[i]?.textContent || '').toLowerCase()
            if (itemText.startsWith(key)) {
                this.selectItem(i)
                break
            }
        }
    }

    startDrag(event) {
        event.preventDefault()
        this.container.focus()

        this.isDragging = true
        this.lastY = this.getEventY(event)
        this.lastTime = performance.now()
        this.velocity = 0
        this.dragStartY = this.lastY
        this.clickedItem = event.target.closest(".circular-list > *")

        this.container.classList.add("dragging")

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId)
        }
    }

    drag(event) {
        if (!this.isDragging) return

        event.preventDefault()
        const currentY = this.getEventY(event)
        const currentTime = Date.now()

        if (currentY !== undefined) {
            const deltaY = currentY - this.lastY
            const deltaTime = currentTime - this.lastTime

            if (deltaTime > 0) {
                this.velocity = (deltaY / deltaTime) * this.VELOCITY_TIME_MULTIPLIER
            }

            let effectiveDeltaY = deltaY
            if (!this.isInfinite) {
                const bounds = this.getBounds()
                const futureOffset = this.currentOffset + deltaY * this.DRAG_SENSITIVITY

                if (futureOffset > bounds.max || futureOffset < bounds.min) {
                    const excess = futureOffset > bounds.max
                        ? futureOffset - bounds.max
                        : bounds.min - futureOffset
                    const normalizedExcess = excess / (this.itemHeight * this.DRAG_RESISTANCE_DISTANCE)
                    const curveStrength = this.resistance * this.CURVE_STRENGTH_MULTIPLIER
                    const resistance = Math.max(this.MIN_RESISTANCE, Math.exp(-normalizedExcess * curveStrength))
                    effectiveDeltaY = deltaY * resistance
                }
            }

            this.currentOffset += effectiveDeltaY * this.DRAG_SENSITIVITY

            if (this.isInfinite) {
                this.handleInfiniteWrap()
            }

            this.updatePositions()
            this.lastY = currentY
            this.lastTime = currentTime
        }
    }

    endDrag(event) {
        if (!this.isDragging) return
        this.isDragging = false
        this.container.classList.remove("dragging")

        const currentY = this.getEventY(event)
        const totalMovement = Math.abs(currentY - this.dragStartY)

        if (totalMovement < 5 && this.clickedItem) {
            this.handleItemClick(this.clickedItem)
        } else {
            this.startInertia()
        }

        this.clickedItem = null
    }

    handleItemClick(clickedElement) {
        const itemIndex = Array.from(this.container.children).indexOf(clickedElement)
        if (itemIndex === -1) return

        if (this.isInfinite) {
            const targetLogicalIndex = itemIndex % this.baseItemCount
            this.updateSelectionForIndex(targetLogicalIndex)
            this.targetOffset = -itemIndex * this.itemHeight
            this.isSnapping = true
            this.animateToTarget()
        } else {
            if (itemIndex >= 0 && itemIndex < this.baseItemCount) {
                this.updateSelectionForIndex(itemIndex)
                this.selectItem(itemIndex)
            }
        }
    }

    // Animation and movement methods
    startInertia() {
        const animate = () => {
            this.velocity *= this.friction

            if (!this.isInfinite) {
                const bounds = this.getBounds()
                if (this.currentOffset > bounds.max) {
                    const excess = this.currentOffset - bounds.max
                    this.currentOffset -= excess * this.snapback
                    this.velocity *= this.dampening
                } else if (this.currentOffset < bounds.min) {
                    const excess = bounds.min - this.currentOffset
                    this.currentOffset += excess * this.snapback
                    this.velocity *= this.dampening
                }
            }

            if (Math.abs(this.velocity) < this.SNAP_THRESHOLD && !this.isOutOfBounds()) {
                this.snapToNearest()
                return
            }

            this.currentOffset += this.velocity
            if (this.isInfinite) this.handleInfiniteWrap()
            this.updatePositions()
            this.updateSelection()
            this.animationFrameId = requestAnimationFrame(animate)
        }
        animate()
    }

    handleInfiniteWrap() {
        const copySize = this.baseItemCount * this.itemHeight
        const bufferCopies = Math.floor((this.totalCopies - 3) / 2)
        const upperBoundary = -copySize * (this.middleCopyIndex - bufferCopies)
        const lowerBoundary = -copySize * (this.middleCopyIndex + bufferCopies)

        if (this.currentOffset > upperBoundary) {
            this.currentOffset -= bufferCopies * copySize
            this.targetOffset -= bufferCopies * copySize
        } else if (this.currentOffset < lowerBoundary) {
            this.currentOffset += bufferCopies * copySize
            this.targetOffset += bufferCopies * copySize
        }
    }

    snapToNearest() {
        const targetIndex = Math.round(-this.currentOffset / this.itemHeight)

        if (this.isInfinite) {
            this.targetOffset = -targetIndex * this.itemHeight
        } else {
            const clampedIndex = Math.max(0, Math.min(this.baseItemCount - 1, targetIndex))
            this.targetOffset = -clampedIndex * this.itemHeight
        }

        this.isSnapping = true
        this.animateToTarget()
    }

    animateToTarget() {
        const animate = () => {
            if (this.targetOffset === undefined) return
            const diff = this.targetOffset - this.currentOffset

            if (Math.abs(diff) < this.ANIMATION_THRESHOLD) {
                this.currentOffset = this.targetOffset
                this.isSnapping = false
                if (this.isInfinite) {
                    this.logicalIndex = this.getCurrentLogicalIndex()
                }
                this.updatePositions()
                this.updateSelection()
                return
            }

            this.currentOffset += diff * this.ANIMATION_SNAP_SPEED
            if (this.isInfinite) this.handleInfiniteWrap()
            this.updatePositions()
            this.animationFrameId = requestAnimationFrame(animate)
        }
        animate()
    }

    // Rendering methods
    updatePositions() {
        const containerHeight = this.container.offsetHeight
        const startY = containerHeight / 2 - this.itemHeight / 2
        const maxDistance = containerHeight / 2

        this.items.forEach((item, index) => {
            const y = startY + index * this.itemHeight + this.currentOffset
            const distanceFromCenter = Math.abs(y - startY)
            const opacity = Math.max(this.MIN_OPACITY, 1 - distanceFromCenter / maxDistance)

            if (this.cylinder3D) {
                const offsetFromCenter = y - startY
                const angle = offsetFromCenter / this.cylinderRadius
                const rotateX = -angle
                const translateZ = (Math.cos(Math.abs(angle)) - 1) * this.cylinderRadius
                const translateY = Math.sin(angle) * this.cylinderRadius + startY

                item.style.opacity = Math.abs(angle) < Math.PI / 2 ? opacity : 0
                item.style.display = Math.abs(angle) < Math.PI / 2 ? "flex" : "none"
                item.style.transform = `translateY(${translateY}px) translateZ(${translateZ}px) rotateX(${rotateX}rad)`
            } else {
                item.style.opacity = opacity
                item.style.display = "flex"
                const scale = Math.max(this.MIN_SCALE, 1 - (distanceFromCenter / maxDistance) * this.SCALE_FACTOR)
                item.style.transform = `translateY(${y}px) scale(${scale})`
            }
        })
    }

    updateSelection() {
        const selectedIndex = this.isInfinite
            ? this.getCurrentLogicalIndex()
            : Math.max(0, Math.min(this.baseItemCount - 1, Math.round(-this.currentOffset / this.itemHeight)))
        this.updateSelectionForIndex(selectedIndex)
    }

    updateSelectionForIndex(logicalIndex) {
        if (this.isInfinite) {
            const selectedValue = this.getValueAtLogicalIndex(logicalIndex)
            this.items.forEach((item) => {
                const itemValue = item.dataset.value || item.textContent
                const isSelected = itemValue === selectedValue
                item.classList.toggle("selected", isSelected)
                item.setAttribute('aria-selected', isSelected.toString())
            })
        } else {
            this.items.forEach((item, index) => {
                const isSelected = index === logicalIndex
                item.classList.toggle("selected", isSelected)
                item.setAttribute('aria-selected', isSelected.toString())
            })
        }

        const selectedItem = this.items.find(item => item.classList.contains('selected'))
        if (selectedItem) {
            if (!selectedItem.id) {
                selectedItem.id = `circular-list-item-${logicalIndex}`
            }
            this.container.setAttribute('aria-activedescendant', selectedItem.id)
        }

        this.updateHiddenInput()
        this.dispatchChangeEvent()
    }

    // Public API methods
    selectItem(index) {
        if (index < 0 || index >= this.baseItemCount) return

        if (this.isInfinite) {
            this.targetOffset = -(index + this.middleCopyIndex * this.baseItemCount) * this.itemHeight
        } else {
            this.targetOffset = -index * this.itemHeight
        }
        this.animateToTarget()
    }

    moveByOffset(itemCount) {
        if (!this.isInfinite) return
        const distanceToPreviousTarget = this.targetOffset === undefined ? 0 : this.targetOffset - this.currentOffset
        this.targetOffset = this.currentOffset + (itemCount * this.itemHeight) + distanceToPreviousTarget
        this.animateToTarget()
    }

    getSelectedIndex() {
        return this.isInfinite
            ? this.getCurrentLogicalIndex()
            : Math.max(0, Math.min(this.baseItemCount - 1, Math.round(-this.currentOffset / this.itemHeight)))
    }

    getSelectedValue() {
        const index = this.getSelectedIndex()
        return this.isInfinite
            ? this.getValueAtLogicalIndex(index)
            : this.items[index]?.dataset.value || this.items[index]?.textContent
    }

    setCylinderRadius(radius) {
        this.cylinderRadius = radius
        if (this.cylinder3D) this.updatePositions()
    }

    setResistance(resistance) {
        this.resistance = resistance
        this.dampening = Math.max(0.6, 0.95 - this.resistance * 0.075)
        this.snapback = Math.max(0.15, Math.min(0.35, 0.25 * this.resistance))
        this.friction = 1.0 - 0.065 * this.resistance + 0.005 * this.resistance ** 2
    }

    setInfiniteMode(infinite) {
        const currentLogicalIndex = this.getCurrentLogicalIndex()
        this.isInfinite = infinite
        this.velocity = 0

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId)
            this.animationFrameId = null
        }

        this.createVirtualItems()
        this.itemCount = this.items.length

        this.currentOffset = infinite
            ? -(currentLogicalIndex + this.middleCopyIndex * this.baseItemCount) * this.itemHeight
            : 0

        this.updatePositions()
        this.updateSelection()
    }

    setPerspective(perspective) {
        this.perspective = perspective
        this.container.style.setProperty("--perspective", `${perspective}px`)
    }

    setCylinder3D(enabled) {
        this.cylinder3D = enabled
        this.container.closest(".circular-list-container")?.classList.toggle("cylinder-3d", enabled)
        this.updatePositions()
    }

    // Event dispatch
    dispatchChangeEvent() {
        const event = new CustomEvent('change', {
            detail: {
                selectedIndex: this.getSelectedIndex(),
                selectedValue: this.getSelectedValue()
            }
        })
        this.container.dispatchEvent(event)
    }

    dispatchSelectionEvent() {
        const event = new CustomEvent('select', {
            detail: {
                selectedIndex: this.getSelectedIndex(),
                selectedValue: this.getSelectedValue(),
                source: 'keyboard'
            }
        })
        this.container.dispatchEvent(event)
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const circularList = new CircularList("circular-list", {
        infinite: true,
        perspective: 1000,
        resistance: 1.0,
        cylinder3D: true,
        cylinderRadius: 250,
    })

    circularList.container.addEventListener('change', (event) => {
        const display = document.getElementById("selected-display")
        if (display) display.textContent = event.detail.selectedValue
    })

    const elements = {
        toggleBtn: document.getElementById("mode-toggle-btn"),
        modeDisplay: document.getElementById("mode-display"),
        effectToggleBtn: document.getElementById("effect-toggle-btn"),
        effectDisplay: document.getElementById("effect-display"),
        perspectiveSlider: document.getElementById("perspective-slider"),
        perspectiveDisplay: document.getElementById("perspective-display"),
        radiusSlider: document.getElementById("radius-slider"),
        radiusDisplay: document.getElementById("radius-display"),
        resistanceSlider: document.getElementById("resistance-slider"),
        resistanceDisplay: document.getElementById("resistance-display")
    }

    const updateDisplays = {
        mode: () => elements.modeDisplay.textContent = circularList.isInfinite ? "Infinite" : "Finite",
        effect: () => elements.effectDisplay.textContent = circularList.cylinder3D ? "On" : "Off",
        perspective: () => elements.perspectiveDisplay.textContent = circularList.perspective.toFixed(1),
        radius: () => elements.radiusDisplay.textContent = `${circularList.cylinderRadius}px`,
        resistance: () => elements.resistanceDisplay.textContent = circularList.resistance.toFixed(1)
    }

    elements.toggleBtn.addEventListener("click", () => {
        circularList.setInfiniteMode(!circularList.isInfinite)
        updateDisplays.mode()
    })

    elements.effectToggleBtn.addEventListener("click", () => {
        circularList.setCylinder3D(!circularList.cylinder3D)
        updateDisplays.effect()
    })

    elements.perspectiveSlider.addEventListener("input", (e) => {
        circularList.setPerspective(parseFloat(e.target.value))
        updateDisplays.perspective()
    })

    elements.radiusSlider.addEventListener("input", (e) => {
        circularList.setCylinderRadius(parseInt(e.target.value))
        updateDisplays.radius()
    })

    elements.resistanceSlider.addEventListener("input", (e) => {
        circularList.setResistance(parseFloat(e.target.value))
        updateDisplays.resistance()
    })

    Object.values(updateDisplays).forEach(fn => fn())
    window.circularList = circularList
})
